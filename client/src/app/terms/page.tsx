import type { Metadata } from 'next';
import LegalPage from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Terms', description: 'The ground rules for using Sync.' };

/** The ground rules, in plain words. Review before relying on it as a legal agreement. */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="7 November 2026">
      <p>By using Sync you agree to these ground rules. They keep campus events fair and friendly for everyone.</p>

      <h2>Your account</h2>
      <ul>
        <li>Use your real name and an email you can read. Keep your password to yourself.</li>
        <li>
          You&apos;re responsible for what happens on your account. If you think someone else got in, change your password and
          sign out of every device in Settings.
        </li>
      </ul>

      <h2>Events</h2>
      <ul>
        <li>Organisers must describe events honestly: real time, place, capacity and who it&apos;s for.</li>
        <li>An RSVP is a promise to turn up. If you can&apos;t, cancel your spot so someone on the waitlist gets it.</li>
        <li>Organisers may set questions, approve places, and check people in at the door.</li>
      </ul>

      <h2>Behaviour</h2>
      <ul>
        <li>No harassment, hate, spam, or anything illegal, in events or in chats.</li>
        <li>
          Report events or messages that break these rules. Admins can remove content, cancel events and suspend accounts, and
          these actions are logged.
        </li>
      </ul>

      <h2>The service</h2>
      <ul>
        <li>
          Sync is provided as it is. We work to keep it running but can&apos;t promise it will never be down or never lose a
          notification.
        </li>
        <li>We may update these terms; the date at the top shows the latest version.</li>
      </ul>
    </LegalPage>
  );
}
