'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, eventsApi, type ScanResult, type SyncEvent } from '@/lib/api';
import { Button } from '@/components/ui/button';

// --- A small QR encoder -----------------------------------------------------
// Only the pieces needed here: byte mode, error correction level M, versions
// 1-10. Keeping it in-tree avoids shipping a QR library for one screen.

type BitBuffer = { bits: number[] };

const pushBits = (buf: BitBuffer, value: number, length: number) => {
  for (let i = length - 1; i >= 0; i -= 1) buf.bits.push((value >>> i) & 1);
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], degree: number): number[] {
  const generator = rsGenerator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) remainder[i] ^= gfMul(generator[i + 1], factor);
  }
  return remainder;
}

// Version 1-10 at correction level M: [total codewords, EC codewords per block].
const VERSION_M: Record<number, [number, number]> = {
  1: [26, 10],
  2: [44, 16],
  3: [70, 26],
  4: [100, 18],
  5: [134, 24],
  6: [172, 16],
  7: [196, 18],
  8: [242, 22],
  9: [292, 22],
  10: [346, 26],
};

const ALIGNMENT_CENTRES: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Encodes text as a QR matrix, or null when it will not fit. */
function encodeQr(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];

  for (let version = 1; version <= 10; version += 1) {
    const [totalCodewords, ecPerBlock] = VERSION_M[version];
    const dataCodewords = totalCodewords - ecPerBlock;
    const size = version * 4 + 17;

    const headerBits = 4 + (version < 10 ? 0 : 0);
    const lengthBits = version < 10 ? 8 : 16;
    const totalDataBits = dataCodewords * 8;
    if (4 + lengthBits + bytes.length * 8 > totalDataBits) continue;

    const buf: BitBuffer = { bits: [] };
    pushBits(buf, 0b0100, 4);
    pushBits(buf, bytes.length, lengthBits);
    for (const byte of bytes) pushBits(buf, byte, 8);

    // Terminator, then pad to a byte boundary, then alternating pad bytes.
    const terminator = Math.min(4, totalDataBits - buf.bits.length);
    pushBits(buf, 0, terminator);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    const dataWords: number[] = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buf.bits[i + j];
      dataWords.push(byte);
    }
    const PAD = [0xec, 0x11];
    for (let i = 0; dataWords.length < dataCodewords; i += 1) dataWords.push(PAD[i % 2]);

    const allWords = [...dataWords, ...rsEncode(dataWords, ecPerBlock)];

    // Lay the modules out.
    const reserved: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    const modules: (boolean | null)[][] = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));

    const setFn = (row: number, col: number, dark: boolean) => {
      if (row < 0 || col < 0 || row >= size || col >= size) return;
      modules[row][col] = dark;
      reserved[row][col] = true;
    };

    // Finder patterns plus their separators.
    for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let r = -1; r <= 7; r += 1) {
        for (let c = -1; c <= 7; c += 1) {
          const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          setFn(fr + r, fc + c, dark);
        }
      }
    }

    // Timing patterns.
    for (let i = 8; i < size - 8; i += 1) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }

    // Alignment patterns, skipping the ones that would touch a finder.
    for (const r of ALIGNMENT_CENTRES[version]) {
      for (const c of ALIGNMENT_CENTRES[version]) {
        const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
        if (nearFinder) continue;
        for (let dr = -2; dr <= 2; dr += 1) {
          for (let dc = -2; dc <= 2; dc += 1) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFn(r + dr, c + dc, dark);
          }
        }
      }
    }

    // Dark module and the format information area (written after masking).
    setFn(size - 8, 8, true);
    for (let i = 0; i < 9; i += 1) {
      if (modules[8][i] === null) setFn(8, i, false);
      if (modules[i][8] === null) setFn(i, 8, false);
    }
    for (let i = 0; i < 8; i += 1) {
      if (modules[8][size - 1 - i] === null) setFn(8, size - 1 - i, false);
      if (modules[size - 1 - i][8] === null) setFn(size - 1 - i, 8, false);
    }

    // Data placement, zig-zagging upward and downward in two-column strips.
    let bitIndex = 0;
    const totalBits = allWords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const col = right - j;
          const upward = ((right + 1) & 2) === 0;
          const row = upward ? size - 1 - vert : vert;
          if (reserved[row][col] || modules[row][col] !== null) continue;
          let dark = false;
          if (bitIndex < totalBits) {
            const word = allWords[bitIndex >>> 3];
            dark = ((word >>> (7 - (bitIndex & 7))) & 1) === 1;
          }
          modules[row][col] = dark;
          bitIndex += 1;
        }
      }
    }

    // Mask pattern 0 and penalty scoring; pick the lowest.
    const MASKS: ((r: number, c: number) => boolean)[] = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (_r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
    ];

    let best: boolean[][] | null = null;
    let bestPenalty = Infinity;

    for (const mask of MASKS) {
      const grid: boolean[][] = modules.map((row, r) => row.map((v, c) => (reserved[r][c] ? Boolean(v) : Boolean(v) !== mask(r, c))));

      // Format information for level M (bits 0b00) and this mask.
      const formatData = (0b00 << 3) | MASKS.indexOf(mask);
      let rem = formatData;
      for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const formatBits = ((formatData << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i += 1) grid[8][i] = ((formatBits >>> i) & 1) === 1;
      grid[8][7] = ((formatBits >>> 6) & 1) === 1;
      grid[8][8] = ((formatBits >>> 7) & 1) === 1;
      grid[7][8] = ((formatBits >>> 8) & 1) === 1;
      for (let i = 9; i <= 14; i += 1) grid[14 - i][8] = ((formatBits >>> i) & 1) === 1;
      for (let i = 0; i <= 7; i += 1) grid[size - 1 - i][8] = ((formatBits >>> i) & 1) === 1;
      for (let i = 8; i <= 14; i += 1) grid[8][size - 15 + i] = ((formatBits >>> i) & 1) === 1;
      grid[size - 8][8] = true;

      const penalty = scorePenalty(grid);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        best = grid;
      }
    }
    return best;
  }
  return null;
}

function scorePenalty(grid: boolean[][]) {
  const size = grid.length;
  let penalty = 0;

  const runScore = (line: boolean[]) => {
    let score = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
    return score;
  };

  for (let r = 0; r < size; r += 1) penalty += runScore(grid[r]);
  for (let c = 0; c < size; c += 1) penalty += runScore(grid.map((row) => row[c]));

  // 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) penalty += 3;
    }
  }

  // Finder-like 1:1:3:1:1 patterns.
  const PATTERN_A = [true, false, true, true, true, false, true, false, false, false, false];
  const PATTERN_B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c <= size - 11; c += 1) {
      const line = grid[r].slice(c, c + 11);
      if (line.every((v, i) => v === PATTERN_A[i]) || line.every((v, i) => v === PATTERN_B[i])) penalty += 40;
    }
  }
  for (let c = 0; c < size; c += 1) {
    for (let r = 0; r <= size - 11; r += 1) {
      const line = grid.slice(r, r + 11).map((row) => row[c]);
      if (line.every((v, i) => v === PATTERN_A[i]) || line.every((v, i) => v === PATTERN_B[i])) penalty += 40;
    }
  }

  // Balance between dark and light.
  const dark = grid.flat().filter(Boolean).length;
  const ratio = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return penalty;
}

function QrSvg({ text, className }: { text: string; className?: string }) {
  const grid = useMemo(() => encodeQr(text), [text]);
  if (!grid) return null;

  const size = grid.length;
  const path = grid
    .flatMap((row, r) => row.map((dark, c) => (dark ? `${c},${r}` : null)))
    .filter(Boolean)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label="Entry code">
      <rect width={size} height={size} fill="#ffffff" />
      <rect x="0" y="0" width={size} height={size} fill="#000000" fillOpacity="0" />
      {/* One path for every dark module keeps the DOM small. */}
      <path d={path.split(' ').map((p) => `M${p.replace(',', ' ')}h1v1h-1z`).join('')} fill="#000000" />
    </svg>
  );
}

// --- The attendee's ticket ----------------------------------------------------

/** The code this person shows at the door. */
export function TicketQr({ event }: { event: SyncEvent }) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    eventsApi
      .ticket(event.id)
      .then((ticket) => {
        if (cancelled) return;
        setToken(ticket?.token ?? null);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  if (failed) return <p className="text-sm text-muted">Could not load your entry code.</p>;
  if (!token) return <p className="text-sm text-muted">Only confirmed attendees have an entry code.</p>;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl bg-white p-3 shadow-inner">
        <QrSvg text={token} className="size-52" />
      </div>
      <p className="max-w-[16rem] text-center text-xs text-muted">Show this at the door. It is scanned once.</p>
    </div>
  );
}

// --- The organiser's scanner --------------------------------------------------

type ScannerProps = { event: SyncEvent; onScanned?: () => void };

/**
 * Scans a ticket with the phone camera using the built-in `BarcodeDetector`.
 * Where the browser does not have it, staff fall back to the manual list.
 */
export default function QrScanner({ event, onScanned }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(true);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  // Kept in a ref so the detection loop always sees the current callback.
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  async function start() {
    setLast(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
      }

      // `BarcodeDetector` is not everywhere yet; Safari notably lacks it.
      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!Detector) {
        setSupported(false);
        stop();
        return;
      }
      const detector = new Detector({ formats: ['qr_code'] });

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value && !busy) {
            setBusy(true);
            try {
              const result = await eventsApi.scan(event.id, value);
              setLast(result);
              onScannedRef.current?.();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }
        } catch {
          // A frame the detector cannot read is normal; keep going.
        }
        if (streamRef.current) requestAnimationFrame(() => void tick());
      };
      requestAnimationFrame(() => void tick());
    } catch {
      toast.error('Camera unavailable. Use the attendee list below instead.');
      stop();
    }
  }

  if (!supported) {
    return (
      <p className="rounded-xl bg-surface-muted p-4 text-sm text-muted">
        This browser cannot scan QR codes. Check people in from the attendee list below.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {scanning ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />
          <button
            onClick={stop}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
          >
            <X className="size-3.5" /> Stop
          </button>
        </div>
      ) : (
        <Button variant="primary" onClick={start} className="w-full">
          <Camera /> Scan entry codes
        </Button>
      )}

      {last && (
        <div className="flex items-center gap-3 rounded-2xl bg-surface-muted p-4">
          {last.attendee?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={last.attendee.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-full bg-surface">
              <Check className="size-5 text-primary" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{last.attendee?.name ?? 'Attendee'}</p>
            <p className="text-xs text-muted">
              {last.alreadyCheckedIn ? 'Already checked in' : 'Checked in'}
            </p>
          </div>
          <RefreshCw
            className="size-4 cursor-pointer text-muted hover:text-foreground"
            onClick={() => setLast(null)}
            aria-label="Scan the next person"
          />
        </div>
      )}
    </div>
  );
}