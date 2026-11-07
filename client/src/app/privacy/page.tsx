import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Sync stores about you, why, and how to get it or delete it.',
};

/** What the app actually stores and shares, in plain words. Review before relying on it as a legal policy. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="7 November 2026">
      <p>
        Sync helps students find campus events, RSVP and get checked in. This page says what we keep about you, why, who else
        handles it, and how to get a copy or delete it.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account: name, email, a hashed password (never the password itself), and anything you add to your profile.</li>
        <li>
          What you do: events you RSVP to, are waitlisted for, bookmark or are checked in at; answers to organisers&apos;
          questions; ratings and feedback; notes; chat messages; clubs you follow.
        </li>
        <li>Notifications we sent you, and your email and notification choices.</li>
        <li>If you turn on notifications on a device, that browser&apos;s push address.</li>
        <li>Short-lived technical records (request logs, rate-limit counters) to keep the service running and safe.</li>
      </ul>

      <h2>Who sees it</h2>
      <ul>
        <li>
          Organisers of an event see who is registered for it, their email, and their answers to that event&apos;s questions. Door
          staff see names only.
        </li>
        <li>Written feedback reaches organisers without your name.</li>
        <li>Platform admins can see accounts, reports and moderation history.</li>
        <li>We don&apos;t sell your data or show ads.</li>
      </ul>

      <h2>Services that handle it for us</h2>
      <ul>
        <li>Hosting: Vercel. Database: MongoDB Atlas (Mumbai region).</li>
        <li>Email delivery: Brevo or the configured mail server.</li>
        <li>Place search: OpenStreetMap Nominatim (the search text only, not your identity).</li>
        <li>Push notifications go through your browser&apos;s push service (for example Google or Apple).</li>
        <li>
          Uploaded cover photos are stored in Vercel Blob. The assistant, when turned on, sends your question to the configured AI
          provider.
        </li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>
          <Link href="/settings" className="underline underline-offset-2">
            Settings
          </Link>{' '}
          lets you download everything we hold about you as a file, change your email, sign out of every device, and delete your
          account.
        </li>
        <li>
          Deleting your account removes your personal data. Events you hosted that already happened stay as other people&apos;s
          attendance history, without your details.
        </li>
        <li>You choose which notifications also come by email on the notifications page.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>Until you delete your account. Delivered emails are cleared after 30 days and read notifications after 90 days.</p>
    </LegalPage>
  );
}
