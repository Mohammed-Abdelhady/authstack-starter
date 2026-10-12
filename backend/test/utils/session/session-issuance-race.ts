import { BrowserIssuanceStore } from '../../../src/session/issuance/browser-issuance.store';
import { SessionIssuanceService } from '../../../src/session/services/session-issuance.service';

export async function runForcedIssuanceRace<TFirst, TSecond>(
  issuance: SessionIssuanceService,
  accounts: BrowserIssuanceStore,
  firstOperation: () => Promise<TFirst>,
  secondOperation: () => Promise<TSecond>,
): Promise<[PromiseSettledResult<TFirst>, PromiseSettledResult<TSecond>]> {
  const countGate = pauseAfterFirstSessionCount(issuance);
  let userReadGate: ReturnType<typeof pauseNextAccountRead> | undefined;
  try {
    const first = firstOperation();
    await countGate.reached;
    userReadGate = pauseNextAccountRead(accounts);
    const second = secondOperation();
    await userReadGate.reached;
    countGate.release();
    userReadGate.release();
    return await Promise.allSettled([first, second]);
  } finally {
    countGate.release();
    userReadGate?.release();
    countGate.restore();
    userReadGate?.restore();
  }
}

function pauseAfterFirstSessionCount(issuance: SessionIssuanceService) {
  let announceReached = () => {};
  let releaseCount = () => {};
  const reached = new Promise<void>((resolve) => {
    announceReached = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseCount = resolve;
  });
  const assertLimit = issuance.assertSessionLimit.bind(issuance);
  let checks = 0;
  const spy = jest
    .spyOn(issuance, 'assertSessionLimit')
    .mockImplementation(async (session, user, application, now) => {
      await assertLimit(session, user, application, now);
      checks += 1;
      if (checks === 1) {
        announceReached();
        await blocked;
      }
    });

  return {
    reached,
    release: releaseCount,
    restore: () => spy.mockRestore(),
  };
}

/** Holds the next issuance, of either kind, once it has read its account. */
function pauseNextAccountRead(accounts: BrowserIssuanceStore) {
  let announceReached = () => {};
  let releaseRead = () => {};
  const reached = new Promise<void>((resolve) => {
    announceReached = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readAccount = accounts.readAccountForIssuance.bind(accounts);
  const spy = jest
    .spyOn(accounts, 'readAccountForIssuance')
    .mockImplementation(async (unitOfWork, userId) => {
      const account = await readAccount(unitOfWork, userId);
      announceReached();
      await blocked;
      return account;
    });

  return {
    reached,
    release: releaseRead,
    restore: () => spy.mockRestore(),
  };
}
