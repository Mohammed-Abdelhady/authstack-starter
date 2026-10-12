import { Types } from 'mongoose';
import { PendingCodeGeneration } from '../../pending-codes/pending-registration.store';

/** The live record a refresh may touch: not expired yet. */
export function buildRefreshFilter(
  email: string,
  purpose: string,
  now: Date,
): Record<string, unknown> {
  return {
    email: { $eq: email },
    purpose,
    expiresAt: { $gt: now },
  };
}

/** The expired record a registration may replace with fresh details. */
export function buildReplaceFilter(
  email: string,
  purpose: string,
  now: Date,
): Record<string, unknown> {
  return {
    email: { $eq: email },
    purpose,
    expiresAt: { $lte: now },
  };
}

/**
 * The pipeline that gives a record a new generation: new code, attempts reset,
 * new expiry. An email-change generation also re-points the record at the
 * current user and address generation, so a move away and back cannot leave a
 * code bound to a superseded generation.
 */
export function buildGenerationPipeline(
  generation: PendingCodeGeneration,
  userId: Types.ObjectId | undefined,
): Record<string, unknown>[] {
  const set: Record<string, unknown> = {
    // A bcrypt hash starts with "$", which a pipeline would read as a field
    // path; $literal keeps it a value.
    hashedCode: { $literal: generation.hashedCode },
    attempts: 0,
    expiresAt: generation.expiresAt,
  };
  if (userId) {
    set.userId = userId;
    set.addressGeneration = generation.addressGeneration ?? 0;
  }
  return [{ $set: set }];
}
