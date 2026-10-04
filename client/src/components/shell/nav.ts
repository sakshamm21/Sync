import { CalendarDays, Compass, Home, Map, Megaphone, MessagesSquare, ShieldCheck, StickyNote, type LucideIcon } from 'lucide-react';
import type { Role } from '@/lib/api';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only shown to these roles; omitted means everyone. */
  roles?: Role[];
}

/** Always visible in the dock. */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/chat', label: 'Chats', icon: MessagesSquare },
];

/** Inline on larger screens, inside "More" on phones. */
export const SECONDARY_NAV: NavItem[] = [
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/map', label: 'Map', icon: Map },
  // Everyone can open the console: organisers manage their own events, and a
  // member invited to help run an event finds it there too.
  { href: '/organizer', label: 'Organizer', icon: Megaphone },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, roles: ['admin'] },
];

export const visibleFor = (items: NavItem[], role: Role | undefined) =>
  items.filter((item) => !item.roles || (role && item.roles.includes(role)));

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
