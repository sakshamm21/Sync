import nodemailer, { type Transporter } from 'nodemailer';
import env from '../config/env';
import logger from './logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user: env.mail.user, pass: env.mail.password },
    });
  }
  return transporter;
}

/** 'Sync <a@b.com>' -> { name, email }; a bare address has no name. */
function parseAddress(address: string): { name?: string; email: string } {
  const match = address.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || undefined, email: match[2].trim() } : { email: address.trim() };
}

async function sendWithBrevo({ to, subject, text, html }: MailInput): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.mail.brevoApiKey!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: parseAddress(env.mail.from!),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = new Error(`Brevo responded ${res.status}: ${await res.text()}`) as MailError;
    // 4xx means the request itself is wrong (bad address, bad sender); retrying won't help.
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }
}

type MailError = Error & { permanent?: boolean; responseCode?: number };

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** What happened to one send attempt. */
export type MailResult =
  | { ok: true }
  | { ok: false; notConfigured: true; retryable: false; error: string }
  | { ok: false; notConfigured?: false; retryable: boolean; error: string };

type Transport = (mail: MailInput) => Promise<void>;
let testTransport: Transport | null = null;

/** Tests only: route mail through a fake transport (which counts as configured). */
export function setTestTransport(transport: Transport | null) {
  testTransport = transport;
}

export const mailConfigured = () => Boolean(testTransport) || env.mail.enabled;

/**
 * Sends an email and reports what happened. Never throws: email is a side
 * channel and must not break the request that triggered it. A failure is
 * `retryable` unless the provider rejected the message itself.
 */
export async function deliver(mail: MailInput): Promise<MailResult> {
  if (!mailConfigured()) {
    logger.warn({ to: mail.to, subject: mail.subject }, 'Email not configured — email not sent');
    if (!env.isProduction) logger.info(`[mail preview] ${mail.subject}\n${mail.text}`);
    return { ok: false, notConfigured: true, retryable: false, error: 'Email is not configured' };
  }

  try {
    if (testTransport) await testTransport(mail);
    else if (env.mail.brevoApiKey) await sendWithBrevo(mail);
    else await getTransporter().sendMail({ from: env.mail.from, ...mail });
    return { ok: true };
  } catch (err) {
    const e = err as MailError;
    // SMTP 5xx replies are permanent rejections; everything else (timeouts,
    // 4xx "try later", network errors) is worth another go.
    const permanent = e.permanent ?? (typeof e.responseCode === 'number' && e.responseCode >= 500);
    logger.error({ err, to: mail.to, subject: mail.subject }, 'Failed to send email');
    return { ok: false, retryable: !permanent, error: e.message.slice(0, 500) };
  }
}

/** Sends right away and resolves to whether it was delivered (auth flows show the code otherwise). */
export async function sendMail(mail: MailInput): Promise<boolean> {
  return (await deliver(mail)).ok;
}
