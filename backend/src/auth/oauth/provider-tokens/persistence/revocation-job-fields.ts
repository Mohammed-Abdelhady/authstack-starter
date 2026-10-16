import {
  REVOCATION_OUTCOME,
  REVOCATION_REASON,
  REVOCATION_STATE,
  type RevocationOutcome,
  type RevocationReason,
  type RevocationState,
} from '../constants/provider-tokens.constants';
import type { ProviderRevocationJob } from '../types/provider-tokens';

/** A stored job's fields, before its codes are checked. */
export interface StoredRevocationFields {
  id: string;
  provider: string;
  userId: string | null;
  reason: string;
  state: string;
  outcome: string | null;
  attempts: number;
  failureCode: string | null;
  flaggedAt: Date | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  settledAt: Date | null;
}

function known<Value extends string>(
  values: Readonly<Record<string, Value>>,
  stored: string,
): Value {
  const value = Object.values(values).find((candidate) => candidate === stored);
  if (value === undefined) {
    throw new Error('A provider revocation holds an unknown code');
  }
  return value;
}

/** The job both adapters read back, with each stored code checked. */
export function revocationJobOf(
  fields: StoredRevocationFields,
): ProviderRevocationJob {
  const reason: RevocationReason = known(REVOCATION_REASON, fields.reason);
  const state: RevocationState = known(REVOCATION_STATE, fields.state);
  const outcome: RevocationOutcome | null =
    fields.outcome === null ? null : known(REVOCATION_OUTCOME, fields.outcome);
  return { ...fields, reason, state, outcome };
}
