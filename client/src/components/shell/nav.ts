import {
  CalendarDays,
  History as HistoryIcon,
  Compass,
  Home,
  Map,
  Megaphone,
  MessagesSquare,
  ShieldCheck,
  StickyNote,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role, User } from '@/lib/api';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only shown to these roles; omitted means everyone. */
  roles?: Role[];
  /** Also shown to members who help run someone else's event. */
  orEventStaff?: boolean;
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
  { href: '/history', label: 'My events', icon: HistoryIcon },
  { href: '/friends', label: 'Friends', icon: Users },
  { href: '/map', label: 'Map', icon: Map },
  // Organisers manage their own events here, and a member invited to help run
  // an event finds it here too. Other members would only see an empty console.
  { href: '/organizer', label: 'Organizer', icon: Megaphone, roles: ['organizer', 'admin'], orEventStaff: true },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, roles: ['admin'] },
];

export const visibleFor = (items: NavItem[], user: Pick<User, 'role' | 'isEventStaff'> | null | undefined) =>
  items.filter((item) => !item.roles || (user && (item.roles.includes(user.role) || (item.orEventStaff && user.isEventStaff))));

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
