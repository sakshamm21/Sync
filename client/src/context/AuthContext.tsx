'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  authApi,
  meApi,
  metaApi,
  tokenStore,
  ApiError,
  SESSION_EXPIRED_EVENT,
  type RegisterResult,
  type ServerMeta,
  type Session,
  type User,
} from '@/lib/api';
import { connectSocket } from '@/lib/realtime';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  /** How live updates arrive: a socket, or polling on serverless hosts. Null until known. */
  realtime: ServerMeta['realtime'] | null;
  /** Whether the server has the AI assistant turned on. */
  assistant: boolean;
  /** Connected while signed in on socket-capable servers; null otherwise. */
  socket: Socket | null;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { name: string; email: string; password: string }) => Promise<RegisterResult>;
  verifyEmail: (email: string, code: string) => Promise<User>;
  resendVerification: (email: string) => Promise<RegisterResult>;
  /** Stores a session returned by any endpoint that signs the user in. */
  startSession: (session: Session) => User;
  setUser: (user: User) => void;
  /** Re-reads the profile, e.g. after the user's role changed. */
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [realtime, setRealtime] = useState<ServerMeta['realtime'] | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const startSession = useCallback((session: Session) => {
    tokenStore.set(session.token);
    setToken(session.token);
    setUser(session.user);
    setStatus('authenticated');
    // The full profile also says whether they help run anyone's event (for the nav).
    void meApi
      .get()
      .then(setUser)
      .catch(() => {});
    return session.user;
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await meApi.get());
  }, []);

  // Restore the session and learn the server's capabilities on first load.
  useEffect(() => {
    metaApi
      .get()
      .then((meta) => {
        setRealtime(meta.realtime);
        setAssistant(Boolean(meta.assistant));
      })
      .catch(() => setRealtime('polling'));

    const stored = tokenStore.get();
    if (!stored) {
      setStatus('anonymous');
      return;
    }
    setToken(stored);
    // Only the server rejecting the token ends the session. A network blip or a
    // cold API is retried, and never deletes the stored login.
    const restore = async (attempt = 1): Promise<void> => {
      try {
        setUser(await meApi.get());
        setStatus('authenticated');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return logout();
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          return restore(attempt + 1);
        }
        // Still unreachable: show the signed-out view, but keep the token so a reload restores the session.
        setToken(null);
        setStatus('anonymous');
      }
    };
    void restore();
  }, [logout]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
  }, [logout]);

  useEffect(() => {
    if (!token || status !== 'authenticated' || realtime !== 'socket') return;
    const next = connectSocket(token);
    setSocket(next);
    return () => {
      next.disconnect();
      setSocket(null);
    };
  }, [token, status, realtime]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      realtime,
      assistant,
      socket,
      login: async (email, password) => startSession(await authApi.login({ email, password })),
      register: (input) => authApi.register(input),
      verifyEmail: async (email, code) => startSession(await authApi.verifyEmail({ email, code })),
      resendVerification: (email) => authApi.resendVerification(email),
      startSession,
      setUser,
      refreshUser,
      logout,
    }),
    [user, status, realtime, assistant, socket, startSession, refreshUser, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

/** Subscribes to a socket event for as long as the component is mounted. */
export function useSocketEvent<T>(eventName: string, handler: (payload: T) => void) {
  const { socket } = useAuth();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(eventName, listener);
    return () => {
      socket.off(eventName, listener);
    };
  }, [socket, eventName]);
}

/** Calls `fn` every `ms` while `enabled` (used when the server can't push updates). */
export function usePolling(fn: () => void, ms: number, enabled: boolean) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fnRef.current();
    }, ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
}
