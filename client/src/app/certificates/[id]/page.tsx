'use client';

/**
 * A participation certificate, laid out for printing: "Save as PDF" in the
 * browser's print dialog gives the PDF students hand in (Roadmap "Next" #5).
 */
import { use, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { errorMessage, eventsApi, type Certificate } from '@/lib/api';
import { formatCampusDateTime } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/surface';
import { LogoMark } from '@/components/shell/Logo';

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status } = useAuth();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'anonymous') {
      setError('Sign in to see your certificate.');
      return;
    }
    eventsApi
      .certificate(id)
      .then(setCert)
      .catch((err) => setError(errorMessage(err)));
  }, [id, status]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24">
        <EmptyState
          emoji="📜"
          title="No certificate"
          description={error}
          action={<ButtonLink href={`/events/${id}`}>Back to the event</ButtonLink>}
        />
      </main>
    );
  }
  if (!cert) return <div className="mx-auto mt-24 h-96 max-w-4xl animate-pulse rounded-3xl bg-surface-muted" />;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 print:p-0">
      <div className="mb-6 flex justify-end gap-2 print:hidden">
        <ButtonLink href={`/events/${id}`} variant="ghost">
          Back
        </ButtonLink>
        <Button onClick={() => window.print()}>
          <Printer /> Print or save as PDF
        </Button>
      </div>
      {/* Fixed light colours so it prints the same in either theme. */}
      <article
        className="relative aspect-[1.414/1] w-full overflow-hidden rounded-3xl border-8 border-double p-12 text-center print:rounded-none"
        style={{ background: '#fffdf8', color: '#0b0b10', borderColor: '#6a3dff' }}
      >
        <div className="flex items-center justify-center gap-2">
          <LogoMark />
          <span className="font-display text-xl font-extrabold">sync.</span>
        </div>
        <p className="mt-10 font-mono text-sm uppercase tracking-[0.3em]" style={{ color: '#5d5866' }}>
          Certificate of participation
        </p>
        <p className="mt-8 text-lg" style={{ color: '#5d5866' }}>
          This certifies that
        </p>
        <h1 className="mt-3 font-serif text-5xl italic">{cert.name}</h1>
        <p className="mt-6 text-lg" style={{ color: '#5d5866' }}>
          took part in
        </p>
        <h2 className="mt-2 font-display text-3xl font-extrabold">{cert.event.title}</h2>
        <p className="mt-3" style={{ color: '#5d5866' }}>
          {formatCampusDateTime(cert.event.startsAt)}
          {cert.event.venue ? ` · ${cert.event.venue}` : ''}
        </p>
        <div className="absolute inset-x-12 bottom-10 flex items-end justify-between text-left text-sm">
          <div>
            <p className="font-semibold">{cert.host}</p>
            <p style={{ color: '#5d5866' }}>Organiser</p>
          </div>
          <p className="font-mono text-xs" style={{ color: '#5d5866' }}>
            Ref. {cert.reference}
          </p>
        </div>
      </article>
    </main>
  );
}
