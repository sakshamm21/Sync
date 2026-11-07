import axios, { AxiosError } from 'axios';

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000'
).replace(/\/$/, '');

const TOKEN_KEY = 'sync.token';

/** Fired when the server rejects the stored token, so the app can sign out. */
export const SESSION_EXPIRED_EVENT = 'sync:session-expired';

export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Storage can be unavailable (private mode); the session then lasts for this tab only.
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  },
};

export interface FieldError {
  field: string;
  message: string;
}

/** Every failed request rejects with this, never with a raw Axios error. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: FieldError[] = []
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Message for a specific form field (e.g. "email"), if the server flagged it. */
  fieldMessage(field: string): string | undefined {
    return this.details.find((d) => d.field.split('.').slice(1).join('.') === field)?.message;
  }
}

export const http = axios.create({ baseURL: `${API_URL}/api`, timeout: 20_000 });

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: { message: string; code: string; details?: FieldError[] } }>) => {
    if (!error.response) {
      return Promise.reject(
        new ApiError('Cannot reach the Sync server. Check your connection and try again.', 0, 'NETWORK_ERROR')
      );
    }
    const { status, data } = error.response;
    const body = data?.error;
    // An expired or revoked session, or an account suspended mid-session: sign out
    // rather than leaving the user facing endless errors.
    const sessionOver =
      (status === 401 && body?.code === 'INVALID_TOKEN') || (status === 403 && body?.code === 'ACCOUNT_SUSPENDED');
    if (sessionOver && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    return Promise.reject(
      new ApiError(body?.message || 'Something went wrong. Please try again.', status, body?.code || 'ERROR', body?.details)
    );
  }
);

/** Human-readable message for anything thrown by an API call. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
