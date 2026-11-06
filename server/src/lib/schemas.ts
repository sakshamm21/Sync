import { z } from 'zod';

export { z };

/** "startsAt" -> "Starts at" */
const humanize = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Friendly default for missing fields: "Title is required" instead of
// "Invalid input: expected string, received undefined".
z.config({
  customError: (issue) => {
    if (issue.code !== 'invalid_type' || issue.input !== undefined) return undefined;
    const field = issue.path?.at(-1);
    return typeof field === 'string' ? `${humanize(field)} is required` : 'This field is required';
  },
});

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParams = z.object({ id: objectId });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export interface Page {
  page: number;
  limit: number;
}

/** Query-string booleans arrive as strings. */
export const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

/**
 * Optional web link that also accepts an empty string (to clear the field).
 * Only http(s): these end up in links, images, emails and calendar files,
 * where `javascript:` or `data:` would be a way to run or smuggle content.
 */
export const optionalUrl = z.union([
  z.literal(''),
  z.url({ protocol: /^https?$/, error: 'Enter a web address starting with https://' }),
]);

export function paginationMeta({ page, limit }: Page, total: number) {
  return { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

/** Escapes user input for use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
