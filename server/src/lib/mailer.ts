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
  if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends an email. Never throws: email is a side channel and must not break
 * the request that triggered it. Resolves to `true` only if it was delivered
 * to the SMTP server.
 */
export async function sendMail({ to, subject, text, html }: MailInput): Promise<boolean> {
  if (!env.mail.enabled) {
    logger.warn({ to, subject }, 'Email not configured — email not sent');
    if (!env.isProduction) logger.info(`[mail preview] ${subject}\n${text}`);
    return false;
  }

  try {
    if (env.mail.brevoApiKey) await sendWithBrevo({ to, subject, text, html });
    else await getTransporter().sendMail({ from: env.mail.from, to, subject, text, html });
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
    return false;
  }
}
