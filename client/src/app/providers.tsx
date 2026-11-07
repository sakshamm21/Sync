'use client';

import { useEffect } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';
import { startDevice } from '@/lib/device';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/context/AuthContext';
import { EventProvider } from '@/context/EventContext';
import { CreateEventProvider } from '@/components/events/CreateEventDialog';

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      toastOptions={{
        classNames: {
          toast: 'rounded-2xl! border! border-border! bg-surface-raised! text-foreground! shadow-overlay! font-sans!',
          title: 'font-semibold!',
          description: 'text-muted!',
          success: '[&_[data-icon]]:text-primary!',
        },
      }}
    />
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(startDevice, []);
  return (
    // Dark ("after dark") is the brand default; day mode and system are in Settings.
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <EventProvider>
          <CreateEventProvider>
            {children}
            <ThemedToaster />
          </CreateEventProvider>
        </EventProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
