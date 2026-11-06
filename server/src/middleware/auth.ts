import type { Request, RequestHandler } from 'express';
import { User, type UserDocument } from '../models';
import { verifyAccessToken, type AccessTokenPayload } from '../lib/tokens';
import { unauthenticated, forbidden } from '../lib/errors';
import { USER_STATUS, type Role } from '../constants';

function readBearerToken(req: Request): string | null {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/**
 * Resolves a token to an active user. Throws AppError for any reason the
 * token cannot be used. Shared by HTTP middleware and the socket server.
 */
export async function resolveUserFromToken(token: unknown): Promise<UserDocument> {
  let payload: AccessTokenPayload;
  try {
    if (typeof token !== 'string') throw new Error('Missing token');
    payload = verifyAccessToken(token);
  } catch {
    throw unauthenticated('Your session has expired. Please sign in again.', 'INVALID_TOKEN');
  }

  const user = await User.findById(payload.sub).select('+passwordChangedAt +sessionsRevokedAt');
  if (!user) throw unauthenticated('This account no longer exists.', 'INVALID_TOKEN');
  if (user.tokenIssuedBeforePasswordChange(payload.iat)) {
    throw unauthenticated('You were signed out. Please sign in again.', 'INVALID_TOKEN');
  }
  if (user.status === USER_STATUS.SUSPENDED) {
    throw forbidden('This account has been suspended.', 'ACCOUNT_SUSPENDED');
  }
  return user;
}

/** Requires a valid token; sets `req.user`. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readBearerToken(req);
  if (!token) throw unauthenticated();
  req.user = await resolveUserFromToken(token);
  next();
};

/** Sets `req.user` when a valid token is present, otherwise continues anonymously. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = readBearerToken(req);
  if (token) {
    try {
      req.user = await resolveUserFromToken(token);
    } catch {
      req.user = undefined;
    }
  }
  next();
};

/** Must run after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

/**
 * The signed-in user, for handlers behind `authenticate`. Throws (rather than
 * returning undefined) so a route that forgot the middleware fails loudly.
 */
export function currentUser(req: { user?: UserDocument }): UserDocument {
  if (!req.user) throw unauthenticated();
  return req.user;
}
