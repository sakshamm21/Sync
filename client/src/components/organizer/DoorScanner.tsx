'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, X, XCircle } from 'lucide-react';
import { ApiError, errorMessage, eventsApi, type SyncEvent } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

type NativeDetector = new (o: { formats: string[] }) => { detect: (v: ImageBitmapSource) => Promise<{ rawValue: string }[]> };

/**
 * Reads QR codes off the video. Uses the browser's `BarcodeDetector` where it
 * exists (Chrome on Android) and falls back to jsQR on canvas frames
 * everywhere else, notably iPhones and desktop Firefox.
 */
async function makeDetector(): Promise<Detect> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
  if (Native) {
    const detector = new Native({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!context || !video.videoWidth) return null;
    // Downscale: a ticket QR is small and 480 px wide is plenty, and much faster.
    const scale = Math.min(1, 480 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** A short beep: high for "in", low for "no". */
function beep(ok: boolean) {
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.3));
    osc.onended = () => void audio.close();
  } catch {
    // Sound is a nicety.
  }
}

/** Codes scanned without a connection, per event, kept on this phone until they sync. */
const queueKey = (eventId: string) => `sync.door-queue.${eventId}`;
function offlineQueue(eventId: string): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(queueKey(eventId)) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function saveQueue(eventId: string, codes: string[]) {
  try {
    if (codes.length) window.localStorage.setItem(queueKey(eventId), JSON.stringify(codes));
    else window.localStorage.removeItem(queueKey(eventId));
  } catch {
    // Storage blocked: the scan simply isn't kept.
  }
}
const queueOffline = (eventId: string, code: string) => {
  const codes = offlineQueue(eventId);
  if (!codes.includes(code)) saveQueue(eventId, [...codes, code]);
};
const dequeueOffline = (eventId: string, code: string) =>
  saveQueue(
    eventId,
    offlineQueue(eventId).filter((c) => c !== code)
  );

type Outcome = { ok: boolean; title: string; detail: string };

const FRAME_MS = 125; // about 8 frames a second
const SAME_CODE_MS = 3000;

/**
 * The door phone's scanner. One request per code: the same code is ignored
 * for a few seconds, and nothing new is sent while a scan is in flight.
 */
export default function DoorScanner({ event, onScanned }: { event: SyncEvent; onScanned?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  // Never leave the camera on after leaving the page.
  useEffect(() => stop, [stop]);

  // Load the fallback decoder now, while there's signal: door Wi-Fi is often
  // patchy, and a lazy load at scan time would fail offline.
  useEffect(() => {
    if (!('BarcodeDetector' in window)) void import('jsqr').catch(() => {});
  }, []);

  // Codes scanned while offline, sent when the connection returns (and every 15 s).
  const [pending, setPending] = useState(0);
  useEffect(() => {
    setPending(offlineQueue(event.id).length);
    let syncing = false;
    const sync = async () => {
      if (syncing || !navigator.onLine) return;
      syncing = true;
      try {
        for (const code of offlineQueue(event.id)) {
          try {
            await eventsApi.scan(event.id, code);
          } catch (err) {
            // Still offline: try again later. Any other answer is final (e.g. a bad code).
            if (err instanceof ApiError && err.code === 'NETWORK_ERROR') break;
            toast.error(`An offline scan was refused: ${errorMessage(err)}`);
          }
          dequeueOffline(event.id, code);
        }
      } finally {
        syncing = false;
        const left = offlineQueue(event.id).length;
        setPending((before) => {
          if (before && !left) onScannedRef.current?.();
          return left;
        });
      }
    };
    void sync();
    window.addEventListener('online', sync);
    const timer = window.setInterval(() => void sync(), 15_000);
    return () => {
      window.removeEventListener('online', sync);
      window.clearInterval(timer);
    };
  }, [event.id]);

  const handleCode = useCallback(
    async (code: string) => {
      const now = Date.now();
      const last = lastCodeRef.current;
      if (busyRef.current || (last && last.code === code && now - last.at < SAME_CODE_MS)) return;
      busyRef.current = true;
      lastCodeRef.current = { code, at: now };
      try {
        const result = await eventsApi.scan(event.id, code);
        const name = result.attendee?.name ?? 'Attendee';
        setOutcome({ ok: true, title: name, detail: result.alreadyCheckedIn ? 'Already checked in' : 'Checked in' });
        beep(true);
        navigator.vibrate?.(80);
        onScannedRef.current?.();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
          // No signal at the door: keep the code and check them in once back online.
          queueOffline(event.id, code);
          setPending(offlineQueue(event.id).length);
          setOutcome({
            ok: true,
            title: 'Saved offline',
            detail: 'Let them in. The check-in syncs when the connection is back.',
          });
          beep(true);
          navigator.vibrate?.(80);
          return;
        }
        setOutcome({ ok: false, title: 'Not admitted', detail: errorMessage(err) });
        beep(false);
        navigator.vibrate?.([60, 60, 60]);
      } finally {
        lastCodeRef.current = { code, at: Date.now() };
        busyRef.current = false;
      }
    },
    [event.id]
  );

  async function start() {
    setCameraError(null);
    setOutcome(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      // The <video> is always mounted, so the ref is ready here.
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const detect = await makeDetector();
      const loop = async () => {
        if (!streamRef.current) return;
        try {
          const code = await detect(video);
          if (code) await handleCode(code);
        } catch {
          // A frame that can't be read is normal; keep going.
        }
        if (streamRef.current) timerRef.current = window.setTimeout(() => void loop(), FRAME_MS);
      };
      void loop();
    } catch (err) {
      stop();
      const denied = (err as DOMException)?.name === 'NotAllowedError';
      setCameraError(
        denied
          ? 'Camera permission was refused. Allow it in the browser settings, or check people in by name below.'
          : 'No camera is available. Check people in by name below.'
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className={cn('relative overflow-hidden rounded-2xl bg-black', !scanning && 'hidden')}>
        <video ref={videoRef} muted playsInline autoPlay className="aspect-square w-full object-cover" />
        <div className="pointer-events-none absolute inset-[18%] rounded-3xl border-2 border-white/70" />
        <button
          onClick={stop}
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
        >
          <X className="size-3.5" /> Stop
        </button>
      </div>

      {!scanning && (
        <Button variant="primary" onClick={start} disabled={starting} className="w-full">
          <Camera /> {starting ? 'Starting camera…' : 'Scan entry codes'}
        </Button>
      )}

      {pending > 0 && (
        <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning" role="status">
          {pending} check-in{pending === 1 ? '' : 's'} waiting to sync. They&apos;ll go through when you&apos;re back online.
        </p>
      )}

      {cameraError && <p className="rounded-xl bg-surface-muted p-4 text-sm text-muted">{cameraError}</p>}

      {outcome && (
        <div
          role="status"
          aria-live="assertive"
          className={cn(
            'flex items-center gap-3 rounded-2xl p-4',
            outcome.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
          )}
        >
          {outcome.ok ? <CheckCircle2 className="size-8 shrink-0" /> : <XCircle className="size-8 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{outcome.title}</p>
            <p className="text-sm opacity-80">{outcome.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}
