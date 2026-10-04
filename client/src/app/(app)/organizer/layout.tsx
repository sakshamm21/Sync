import RequireAuth from '@/components/auth/RequireAuth';

// Any signed-in user may open the console: organisers see their own events, and
// a member who was invited to help run one event sees just that event. The API
// decides what each person is shown.
export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
