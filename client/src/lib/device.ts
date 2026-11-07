'use client';

/**
 * This device: the service worker, push notifications and "Install app".
 * Everything here degrades quietly where a browser lacks the feature.
 */
import { useEffect, useState } from 'react';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredInstall: InstallPrompt | null = null;
const installListeners = new Set<() => void>();

/** Registers the service worker once and remembers the browser's install prompt. */
export function startDevice() {
  if (typeof window === 'undefined') return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Show our own button instead of the browser's mini bar.
    deferredInstall = e as InstallPrompt;
    installListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installListeners.forEach((l) => l());
  });
}

/** Whether the browser will let us show "Install app", and a function that does it. */
export function useInstallPrompt() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const update = () => setAvailable(Boolean(deferredInstall));
    update();
    installListeners.add(update);
    return () => {
      installListeners.delete(update);
    };
  }, []);
  return {
    available,
    install: async () => {
      if (!deferredInstall) return;
      await deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      installListeners.forEach((l) => l());
    },
  };
}

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** VAPID public key (base64url) -> the bytes PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Asks permission and subscribes this browser; returns the subscription to send to the API. */
export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser settings.');
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  return subscription.toJSON();
}
