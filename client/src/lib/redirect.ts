/**
 * Where to go after signing in. Only same-site paths are followed: `next` is
 * resolved against our own origin and anything that lands elsewhere (such as
 * `//evil.com` or `/\evil.com`, which browsers treat like `//`) is ignored.
 */
export function safeNextPath(next: string | null, origin: string, fallback: string): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
