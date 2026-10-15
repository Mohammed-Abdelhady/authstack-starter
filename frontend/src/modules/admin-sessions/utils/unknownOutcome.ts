import { httpStatusOf, type RequestError } from '@/lib/refusal';

export function hasUnknownOutcome(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return true;
  const status = httpStatusOf(error as RequestError);
  return status === undefined || status >= 500 || status === 408;
}
