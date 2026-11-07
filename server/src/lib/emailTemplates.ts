export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: unknown) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f6f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1b2e">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e6f0;border-radius:20px;overflow:hidden">
      <tr><td style="padding:20px 28px;background:#5b4be8;background-image:linear-gradient(135deg,#5b4be8,#a855f7);color:#ffffff;font-weight:600;font-size:17px">Sync</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(title)}</h1>
        <div style="font-size:15px;line-height:1.6;color:#4a4860">${bodyHtml}</div>
      </td></tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;color:#8b89a0">You're receiving this because you have a Sync account.</p>
  </body>
</html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#5b4be8;color:#ffffff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;

export function verificationCode({
  name,
  otp,
  expiresInMinutes,
}: {
  name: string;
  otp: string;
  expiresInMinutes: number;
}): EmailContent {
  const subject = `${otp} is your Sync verification code`;
  const text = `Hi ${name},\n\nYour verification code is ${otp}. It expires in ${expiresInMinutes} minutes.\n\nIf you didn't create a Sync account, you can ignore this email.`;
  const html = layout(
    'Verify your email',
    `<p>Hi ${escapeHtml(name)},</p>
     <p>Use this code to finish creating your account:</p>
     <p style="font-size:32px;font-weight:700;letter-spacing:10px;margin:20px 0;color:#1d1b2e;font-family:ui-monospace,Menlo,monospace">${escapeHtml(otp)}</p>
     <p style="color:#8b89a0;font-size:13px">It expires in ${expiresInMinutes} minutes. If you didn't sign up, ignore this email.</p>`
  );
  return { subject, text, html };
}

export function passwordReset({
  name,
  resetUrl,
  expiresInMinutes,
}: {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): EmailContent {
  const subject = 'Reset your Sync password';
  const text = `Hi ${name},\n\nReset your password here: ${resetUrl}\nThe link expires in ${expiresInMinutes} minutes.\n\nIf you didn't request this, you can ignore this email.`;
  const html = layout(
    'Reset your password',
    `<p>Hi ${escapeHtml(name)},</p>
     <p>We received a request to reset your password.</p>
     ${button(resetUrl, 'Choose a new password')}
     <p style="color:#8b89a0;font-size:13px">The link expires in ${expiresInMinutes} minutes. If you didn't request this, ignore this email.</p>`
  );
  return { subject, text, html };
}

/** Generic notification email (reminders, event changes, approvals). */
export function notification({
  name,
  title,
  body,
  url,
}: {
  name: string;
  title: string;
  body: string;
  url?: string;
}): EmailContent {
  const text = `Hi ${name},\n\n${body}${url ? `\n\n${url}` : ''}`;
  const html = layout(
    title,
    `<p>Hi ${escapeHtml(name)},</p>
     <p>${escapeHtml(body)}</p>
     ${url ? button(url, 'Open Sync') : ''}`
  );
  return { subject: title, text, html };
}
