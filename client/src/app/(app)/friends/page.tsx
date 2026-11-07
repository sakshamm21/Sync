'use client';

/** Friends (Roadmap "Next" #7): add by email, accept requests, see who's going where. */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { errorMessage, friendsApi, type FriendsList } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Avatar, Card, PageHeader } from '@/components/ui/surface';

export default function FriendsPage() {
  const [list, setList] = useState<FriendsList | null>(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const load = () =>
    friendsApi
      .list()
      .then(setList)
      .catch((err) => toast.error(errorMessage(err)));
  useEffect(() => {
    void load();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await friendsApi.request(email.trim());
      toast.success('Request sent', { description: "If they're on Sync, they'll get a notification." });
      setEmail('');
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  const act = async (fn: () => Promise<FriendsList>) => {
    try {
      setList(await fn());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        kicker="Better together"
        title={
          <>
            Your <em>friends</em>
          </>
        }
        description="Friends see which events each other is going to, on event cards and pages. Nothing is shared until both of you agree."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden">
          {list?.incoming.length ? (
            <div className="border-b border-border p-4">
              <h2 className="mb-3 font-semibold">Requests</h2>
              <ul className="space-y-2">
                {list.incoming.map((r) => (
                  <li key={r.id} className="flex items-center gap-3">
                    <Avatar name={r.user?.name ?? '?'} src={r.user?.avatarUrl} size={36} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.user?.name}</span>
                    <Button size="sm" onClick={() => act(() => friendsApi.respond(r.id, true))}>
                      Accept
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(() => friendsApi.respond(r.id, false))}>
                      Decline
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="p-4">
            <h2 className="mb-3 font-semibold">Friends</h2>
            {!list ? (
              <div className="h-24 animate-pulse rounded-xl bg-surface-muted" />
            ) : list.friends.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No friends yet. Add someone by their email.</p>
            ) : (
              <ul className="divide-y divide-border">
                {list.friends.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={f.user?.name ?? '?'} src={f.user?.avatarUrl} size={36} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.user?.name}</span>
                    {f.user && (
                      <button
                        type="button"
                        className="text-xs text-muted hover:text-danger"
                        onClick={() => act(() => friendsApi.remove(f.user!.id))}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {list?.outgoing.length ? (
              <p className="mt-4 text-xs text-muted">Waiting on: {list.outgoing.map((o) => o.user?.name).join(', ')}</p>
            ) : null}
          </div>
        </Card>
        <Card className="p-5">
          <form onSubmit={send} className="space-y-3">
            <Field label="Add a friend by email" htmlFor="friend-email">
              <Input
                id="friend-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@college.edu"
                required
              />
            </Field>
            <Button type="submit" loading={sending} className="w-full">
              <UserPlus /> Send request
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
