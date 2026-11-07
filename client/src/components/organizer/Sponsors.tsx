'use client';

/** The club's sponsors (Roadmap "Later" #6), listed on its public page. */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { errorMessage, opsApi, type Sponsor, type SponsorTier } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Badge, Card } from '@/components/ui/surface';

export const TIER_LABEL: Record<SponsorTier, string> = { title: 'Title sponsor', gold: 'Gold', partner: 'Partner' };

export default function Sponsors() {
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', tier: 'partner' as SponsorTier });

  useEffect(() => {
    opsApi
      .sponsors()
      .then(setSponsors)
      .catch(() => setSponsors(null));
  }, []);

  const run = async (fn: () => Promise<Sponsor[]>, done: string) => {
    setBusy(true);
    try {
      setSponsors(await fn());
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!sponsors) return null;
  return (
    <Card className="mt-8 p-5">
      <h2 className="font-semibold">Sponsors</h2>
      <p className="mb-4 mt-0.5 text-sm text-muted">Sponsors added here are listed on your club page, title sponsors first.</p>
      {sponsors.length > 0 && (
        <ul className="mb-4 divide-y divide-border">
          {sponsors.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                {s.url && <p className="truncate text-xs text-muted">{s.url}</p>}
              </div>
              <Badge tone={s.tier === 'title' ? 'primary' : s.tier === 'gold' ? 'warning' : 'neutral'}>
                {TIER_LABEL[s.tier]}
              </Badge>
              <button
                type="button"
                className="text-xs text-muted hover:text-danger"
                onClick={() => run(() => opsApi.removeSponsor(s.id), 'Removed')}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () => opsApi.addSponsor({ name: form.name.trim(), url: form.url.trim(), logoUrl: '', tier: form.tier }),
            'Sponsor added'
          );
          if (ok) setForm({ name: '', url: '', tier: 'partner' });
        }}
      >
        <Input
          aria-label="Sponsor name"
          placeholder="Sponsor name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          required
        />
        <Input
          type="url"
          aria-label="Sponsor website (optional)"
          placeholder="https://… (optional)"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
        />
        <select
          value={form.tier}
          aria-label="Sponsor tier"
          onChange={(e) => setForm({ ...form, tier: e.target.value as SponsorTier })}
          className="h-12 rounded-2xl border border-border bg-surface-muted px-3 text-sm outline-none focus:border-primary"
        >
          <option value="title">Title sponsor</option>
          <option value="gold">Gold</option>
          <option value="partner">Partner</option>
        </select>
        <Button type="submit" loading={busy}>
          <Plus /> Add sponsor
        </Button>
      </form>
    </Card>
  );
}
