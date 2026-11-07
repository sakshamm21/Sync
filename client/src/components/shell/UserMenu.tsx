'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Settings, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/lib/format';
import { Popover, MenuItem } from '@/components/ui/overlay';
import { Avatar, Badge } from '@/components/ui/surface';

export default function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;

  return (
    <Popover
      className="w-64 p-1.5"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          aria-expanded={open}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition hover:bg-surface-muted"
        >
          <Avatar name={user.name} src={user.avatarUrl} size={32} />
          <ChevronDown className="hidden size-4 text-muted sm:block" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar name={user.name} src={user.avatarUrl} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
              {user.role !== 'member' && (
                <Badge tone="primary" className="mt-1">
                  {ROLE_LABELS[user.role]}
                </Badge>
              )}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <MenuItem
            icon={<Settings />}
            onClick={() => {
              close();
              router.push('/settings');
            }}
          >
            Settings
          </MenuItem>
          <MenuItem
            icon={<LogOut />}
            onClick={() => {
              close();
              logout();
              router.push('/authentication');
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Popover>
  );
}
