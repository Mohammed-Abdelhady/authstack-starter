import { NativeContractHarness } from './native-contract-harness';
import { actions, approvedCode, ApprovedCode } from './native-contract-support';

export interface Stored {
  sessions: number;
  tokens: number;
  accountFence: number | undefined;
  events: string[];
}

export const NOTHING: Stored = {
  sessions: 0,
  tokens: 0,
  accountFence: 0,
  events: [],
};

/** An approved code for a new account, or for the one given. */
export async function approved(
  harness: NativeContractHarness,
  userId?: string,
): Promise<ApprovedCode & { userId: string }> {
  const account = userId ?? (await harness.issuance.seedAccount());
  return {
    ...(await approvedCode(harness.services(), account)),
    userId: account,
  };
}

/** What an account's exchanges left stored, with every event recorded. */
export async function stored(
  harness: NativeContractHarness,
  userId: string,
): Promise<Stored> {
  const sessions = await harness.issuance.sessions(userId);
  const tokens = await Promise.all(
    sessions.map(({ id }) => harness.credentialsOf(id)),
  );
  return {
    sessions: sessions.length,
    tokens: tokens.flat().length,
    accountFence: (await harness.issuance.account(userId))?.issuanceFence,
    events: await actions(harness),
  };
}
