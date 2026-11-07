import crypto from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import env from '../config/env';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: string;
  iat: number;
}

const SESSION_AUDIENCE = 'session';

export function signAccessToken(user: { id?: unknown; role: string }): string {
  return jwt.sign({ sub: String(user.id), role: user.role }, env.jwtSecret, {
    algorithm: 'HS256',
    audience: SESSION_AUDIENCE,
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

/** Throws a jsonwebtoken error if the token is invalid or expired. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the algorithm so a token can never pick its own (e.g. "none").
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || !payload.sub || typeof payload.iat !== 'number') {
    throw new jwt.JsonWebTokenError('Malformed token');
  }
  // Sessions signed before audiences were added have none; anything else must be a session.
  if (payload.aud !== undefined && payload.aud !== SESSION_AUDIENCE) {
    throw new jwt.JsonWebTokenError('Malformed token');
  }
  return payload as AccessTokenPayload;
}

/** Six-digit numeric one-time code. */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Opaque URL-safe token for links sent by email (password reset). */
export function generateUrlToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
