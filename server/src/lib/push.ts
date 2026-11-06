/**
 * Web Push: notifications on phones and desktops, even with the app closed.
 * Off unless VAPID keys are configured. Sending never throws; subscriptions
 * the push service reports as gone (404/410) are deleted.
 */
import webpush from 'web-push';
import type { Types } from 'mongoose';
import env from '../config/env';
import logger from './logger';
import { PushSubscription } from '../models';

let configured = false;
function ready(): boolean {
  if (!env.push.enabled) return false;
  if (!configured) {
    webpush.setVapidDetails(env.push.subject, env.push.publicKey!, env.push.privateKey!);
    configured = true;
  }
  return true;
}

export interface PushMessage {
  title: string;
  body?: string;
  /** Opened when the notification is tapped. */
  url?: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
let testSender: Sender | null = null;
/** Tests only: capture pushes instead of sending them. */
export function setTestPushSender(sender: Sender | null) {
  testSender = sender;
}

export async function sendPush(userIds: (Types.ObjectId | string)[], message: PushMessage): Promise<number> {
  if (!testSender && !ready()) return 0;
  const subs = await PushSubscription.find({ user: { $in: userIds } });
  const payload = JSON.stringify(message);
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const target = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
        if (testSender) await testSender(target, payload);
        else await webpush.sendNotification(target, payload, { TTL: 60 * 60 * 24 });
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await PushSubscription.deleteOne({ _id: sub._id });
        else logger.warn({ err: (err as Error).message, status }, 'Push failed');
      }
    })
  );
  return sent;
}

export const pushConfigured = () => Boolean(testSender) || env.push.enabled;
