'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { clubsApi, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

/** Follow a club to be told when it publishes something new. */
export default function FollowButton({
  clubId,
  following,
  onChange,
  size = 'md',
}: {
  clubId: string;
  following: boolean;
  onChange: (state: { following: boolean; followers: number }) => void;
  size?: 'sm' | 'md';
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (user?.id === clubId) return null;

  async function toggle() {
    if (!user) {
      router.push(`/authentication?next=${encodeURIComponent(`/clubs/${clubId}`)}`);
      return;
    }
    setPending(true);
    try {
      onChange(await clubsApi.setFollowing(clubId, !following));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant={following ? 'secondary' : 'primary'} size={size} loading={pending} onClick={toggle} aria-pressed={following}>
      {!pending && (following ? <Check /> : <Plus />)}
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}
