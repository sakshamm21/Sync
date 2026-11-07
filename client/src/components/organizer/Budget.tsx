'use client';

/**
 * An event's budget (Roadmap "Later" #6): what came in (sponsors, tickets,
 * college grant) and what went out, with the running balance. Organisers only.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { errorMessage, opsApi, type BudgetLine, type EventBudget } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Card } from '@/components/ui/surface';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default function Budget({ eventId }: { eventId: string }) {
  const [budget, setBudget] = useState<EventBudget | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<BudgetLine['kind']>('expense');

  useEffect(() => {
    opsApi
      .budget(eventId)
      .then(setBudget)
      .catch(() => setBudget(null));
  }, [eventId]);

  const run = async (fn: () => Promise<EventBudget>) => {
    setBusy(true);
    try {
      setBudget(await fn());
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value < 0) return toast.error('Enter an amount in rupees');
    if (await run(() => opsApi.addBudgetLine(eventId, { label: label.trim(), amount: value, kind }))) {
      setLabel('');
      setAmount('');
    }
  };

  if (!budget) return null;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Budget</h2>
      <p className="mb-4 mt-0.5 text-xs text-muted">Only organisers see this. Amounts are in rupees.</p>

      <dl className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl bg-success-soft p-3">
          <dt className="text-xs text-muted">In</dt>
          <dd className="font-display text-lg font-bold text-success">{rupees.format(budget.income)}</dd>
        </div>
        <div className="rounded-2xl bg-danger-soft p-3">
          <dt className="text-xs text-muted">Out</dt>
          <dd className="font-display text-lg font-bold text-danger">{rupees.format(budget.expense)}</dd>
        </div>
        <div className="rounded-2xl bg-surface-muted p-3">
          <dt className="text-xs text-muted">Balance</dt>
          <dd className={cn('font-display text-lg font-bold', budget.balance < 0 && 'text-danger')}>
            {rupees.format(budget.balance)}
          </dd>
        </div>
      </dl>

      {budget.lines.length > 0 && (
        <ul className="mb-4 divide-y divide-border">
          {budget.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{l.label}</p>
                {l.addedBy && <p className="text-xs text-subtle">Added by {l.addedBy}</p>}
              </div>
              <span className={cn('font-medium tabular-nums', l.kind === 'income' ? 'text-success' : 'text-danger')}>
                {l.kind === 'income' ? '+' : '−'}
                {rupees.format(l.amount)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${l.label}`}
                className="text-muted hover:text-danger"
                onClick={() => run(() => opsApi.removeBudgetLine(eventId, l.id))}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="What it was"
          placeholder="e.g. Snacks, or Sponsor: Acme"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          required
        />
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Amount in rupees"
          placeholder="₹"
          className="sm:w-28"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <select
          value={kind}
          aria-label="Income or expense"
          onChange={(e) => setKind(e.target.value as BudgetLine['kind'])}
          className="h-12 rounded-2xl border border-border bg-surface-muted px-3 text-sm outline-none focus:border-primary"
        >
          <option value="expense">Spent</option>
          <option value="income">Received</option>
        </select>
        <Button type="submit" loading={busy}>
          <Plus /> Add to budget
        </Button>
      </form>
    </Card>
  );
}
