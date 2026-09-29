import { z } from 'zod';

export const Uuid = z.uuid({ message: 'Must be a valid id' });

/** Parses a single UUID route param, e.g. `idParam(req, 'lessonId')`. */
export function idParam(req: { params: Record<string, string | string[] | undefined> }, name: string): string {
  return z.object({ [name]: Uuid }).parse({ [name]: req.params[name] })[name] as string;
}

export const Email = z.email().max(254).transform((e) => e.toLowerCase());
export const Password = z.string().min(8, 'Password must be at least 8 characters').max(72);
export const NonEmpty = (max: number) => z.string().trim().min(1).max(max);
