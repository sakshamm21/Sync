import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me-in-production';

// Google Gemini's OpenAI-compatible endpoint: free tier, no card needed.
const DEFAULT_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_AI_MODEL = 'gemini-3.8-flash';

const booleanFlag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DB_URI: z.string().min(1, 'DB_URI is required').optional(),
    JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
    JWT_EXPIRES_IN: z.string().default('7d'),
    // Comma-separated list of allowed browser origins.
    CLIENT_URL: z.string().default('http://localhost:3000'),
    // Vercel puts exactly one proxy in front of the function, so trust it there;
    // otherwise every visitor would share the proxy's IP (and its rate limits).
    TRUST_PROXY: z.coerce
      .number()
      .int()
      .min(0)
      .default(process.env.VERCEL ? 1 : 0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    // 'socket' for long-running hosts; 'polling' for serverless (Vercel), which can't hold WebSockets.
    REALTIME: z.enum(['socket', 'polling']).default(process.env.VERCEL ? 'polling' : 'socket'),
    // Secret Vercel Cron sends as a bearer token when calling scheduled job endpoints.
    CRON_SECRET: z.string().optional(),
    // Show verification codes / reset links in the API response when email can't be sent.
    // Always on outside production; in production only for demos without email.
    EXPOSE_VERIFICATION_CODES: booleanFlag('false'),
    ENABLE_JOBS: booleanFlag('true'),
    // A public demo with shared accounts: reset the demo data nightly and stop
    // visitors from changing the shared accounts' passwords or roles.
    DEMO_MODE: booleanFlag('false'),
    // Where the campus is: place search prefers results near here and in these countries.
    CAMPUS_LATITUDE: z.coerce.number().min(-90).max(90).default(26.5123),
    CAMPUS_LONGITUDE: z.coerce.number().min(-180).max(180).default(80.2329),
    PLACES_COUNTRY_CODES: z.string().default('in'),
    // Comma-separated email domains allowed to sign up (e.g. "iitk.ac.in"); empty = anyone.
    // Subdomains count too: "iitk.ac.in" also allows "cse.iitk.ac.in".
    ALLOWED_EMAIL_DOMAINS: z.string().default(''),
    // IANA time zone of the campus; used for demo dates and server-side formatting.
    CAMPUS_TIMEZONE: z
      .string()
      .default('Asia/Kolkata')
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'CAMPUS_TIMEZONE must be an IANA time zone, e.g. Asia/Kolkata'),

    // Brevo's HTTP API (preferred on serverless). If set, it's used instead of SMTP.
    BREVO_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    // AI assistant. Any OpenAI-compatible chat completions API works (Gemini, OpenAI,
    // Groq, OpenRouter, Ollama...). Without a key the assistant is switched off.
    AI_API_KEY: z.string().optional(),
    AI_BASE_URL: z.url().default(DEFAULT_AI_BASE_URL),
    AI_MODEL: z.string().min(1).default(DEFAULT_AI_MODEL),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.DB_URI) {
      ctx.addIssue({ code: 'custom', path: ['DB_URI'], message: 'DB_URI is required in production' });
    }
    if (env.JWT_SECRET === DEV_JWT_SECRET || env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be set to a random string of at least 32 characters in production',
      });
    }
  });

/** 'https://app-*.vercel.app' -> RegExp, so preview deployments can be allowed. */
function toOriginMatcher(origin: string): string | RegExp {
  if (!origin.includes('*')) return origin;
  const escape = (part: string) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${origin.split('*').map(escape).join('[a-z0-9-]+')}$`);
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Logger depends on config, so fall back to stderr here.
  console.error(`Invalid environment configuration:\n${problems}`);
  process.exit(1);
}

const raw = parsed.data;

const env = Object.freeze({
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  dbUri: raw.DB_URI,
  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,
  // Allowed CORS origins: exact strings, or RegExps for entries containing '*'.
  // Outside production any localhost port is allowed, since Next.js picks another port when 3000 is busy.
  clientOrigins: [
    ...raw.CLIENT_URL.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map(toOriginMatcher),
    ...(raw.NODE_ENV === 'production' ? [] : [/^http:\/\/localhost:\d+$/]),
  ],
  // First origin is used to build links in emails.
  clientUrl: raw.CLIENT_URL.split(',')[0].trim(),
  trustProxy: raw.TRUST_PROXY,
  logLevel: raw.LOG_LEVEL ?? (raw.NODE_ENV === 'test' ? 'silent' : 'info'),
  enableJobs: raw.ENABLE_JOBS && raw.NODE_ENV !== 'test',
  realtime: raw.REALTIME,
  cronSecret: raw.CRON_SECRET,
  demoMode: raw.DEMO_MODE,
  campusTimeZone: raw.CAMPUS_TIMEZONE,
  allowedEmailDomains: raw.ALLOWED_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean),
  campus: { latitude: raw.CAMPUS_LATITUDE, longitude: raw.CAMPUS_LONGITUDE, countryCodes: raw.PLACES_COUNTRY_CODES },
  exposeVerificationCodes: raw.NODE_ENV !== 'production' || raw.EXPOSE_VERIFICATION_CODES,
  mail: {
    brevoApiKey: raw.BREVO_API_KEY,
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    user: raw.SMTP_USER,
    password: raw.SMTP_PASSWORD,
    from: raw.MAIL_FROM || raw.SMTP_USER,
    enabled: Boolean(raw.BREVO_API_KEY ? raw.MAIL_FROM : raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASSWORD),
  },
  ai: {
    apiKey: raw.AI_API_KEY,
    baseUrl: raw.AI_BASE_URL.replace(/\/$/, ''),
    model: raw.AI_MODEL,
    enabled: Boolean(raw.AI_API_KEY),
  },
  usingDevJwtSecret: raw.JWT_SECRET === DEV_JWT_SECRET,
});

export type Env = typeof env;
export default env;
