import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import {
  contractSession,
  HarnessSource,
  rejectionOf,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_CLIENT,
} from './issuance-contract-support';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SIGN_IN_EVENT = 'session_issued';
const MALFORMED_IDS = { word: 'not-an-id', empty: '' } as const;

/** What the port promises whoever calls it: ids, atomicity and shared errors. */
export function issuanceSeamCases(harness: HarnessSource): void {
  const inUnitOfWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);
  const signIn = (userId: string) =>
    harness()
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        'Contract/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT_ID,
      );

  it('hands ids out as strings and takes the same strings back', async () => {
    const userId = await harness().seedAccount();
    const store = harness().store;

    const ids = await inUnitOfWork(async (unitOfWork) => {
      const account = await store.readAccountForIssuance(unitOfWork, userId);
      const created = await store.createGrant(unitOfWork, {
        userId,
        clientId: WEB_CLIENT,
        allowedScopes: ['api'],
      });
      const found = await store.findGrant(unitOfWork, userId, WEB_CLIENT);
      await store.markGrantIssuance(unitOfWork, created.id);
      const sessionId = await store.insertBrowserSession(unitOfWork, {
        ...contractSession(userId, HASH_A),
        userVerified: true,
        policyVersion: 4,
      });
      return {
        account: account?.id,
        createdGrant: created.id,
        foundGrant: found?.id,
        sessionId,
      };
    });

    const [grant] = await harness().grants(userId);
    const [session] = await harness().sessions(userId);
    expect({
      ...ids,
      idTypes: [typeof ids.createdGrant, typeof ids.sessionId],
      storedGrantFence: grant.issuanceFence,
      userVerified: session.userVerified,
      policyVersion: session.policyVersion,
    }).toEqual({
      account: userId,
      createdGrant: grant.id,
      foundGrant: grant.id,
      sessionId: session.id,
      idTypes: ['string', 'string'],
      storedGrantFence: 1,
      userVerified: true,
      policyVersion: 4,
    });
  });

  it.each([
    ['a word', 'word'],
    ['an empty string', 'empty'],
    ["another database's id", 'foreign'],
  ] as const)(
    'refuses %s as malformed in every method that takes an id',
    async (_, kind) => {
      const id =
        kind === 'foreign' ? harness().foreignAccountId() : MALFORMED_IDS[kind];
      const store = harness().store;
      const attempts: Array<(unitOfWork: UnitOfWork) => Promise<unknown>> = [
        (unitOfWork) => store.readAccountForIssuance(unitOfWork, id),
        (unitOfWork) => store.markAccountIssuance(unitOfWork, id),
        (unitOfWork) => store.findGrant(unitOfWork, id, WEB_CLIENT),
        (unitOfWork) =>
          store.createGrant(unitOfWork, {
            userId: id,
            clientId: WEB_CLIENT,
            allowedScopes: [],
          }),
        (unitOfWork) => store.markGrantIssuance(unitOfWork, id),
        (unitOfWork) =>
          store.listSessionCapCandidates(unitOfWork, {
            userId: id,
            userVersion: 0,
            authEpoch: 1,
            now: harness().clock.now(),
            purposes: ['browser_session'],
          }),
        (unitOfWork) =>
          store.insertBrowserSession(unitOfWork, contractSession(id, HASH_A)),
      ];

      const refusals: boolean[] = [];
      for (const attempt of attempts) {
        const failure = await rejectionOf(inUnitOfWork(attempt));
        refusals.push(failure instanceof MalformedIdError);
      }

      expect(refusals).toEqual([true, true, true, true, true, true, true]);
    },
  );

  it('answers a sign-in for a malformed id as an unavailable authority', async () => {
    await expect(signIn('not-an-id')).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
    });
    expect(await harness().events()).toEqual([]);
  });

  it('says whether the account it was asked to count was there', async () => {
    const userId = await harness().seedAccount();
    const store = harness().store;

    const marks = await inUnitOfWork(async (unitOfWork) => [
      await store.markAccountIssuance(unitOfWork, userId),
      await store.markAccountIssuance(unitOfWork, harness().absentAccountId()),
    ]);

    expect({
      marks,
      fence: (await harness().account(userId))?.issuanceFence,
    }).toEqual({ marks: ['marked', 'account_missing'], fence: 1 });
  });

  it('reports a refused duplicate as a unique conflict that names the rule', async () => {
    const userId = await harness().seedAccount();
    const allowEvents = await harness().refuseSecurityEvents();

    let failure: unknown;
    try {
      failure = await rejectionOf(
        inUnitOfWork((unitOfWork) =>
          harness().store.appendSecurityEvent(unitOfWork, {
            targetUserId: userId,
            clientId: WEB_CLIENT,
            sessionId: 'contract-session',
            action: SIGN_IN_EVENT,
          }),
        ),
      );
    } finally {
      allowEvents();
    }

    expect({
      shared: failure instanceof UniqueConflictError,
      constraint:
        failure instanceof UniqueConflictError ? failure.constraint : null,
    }).toEqual({ shared: true, constraint: 'security_event.event_id' });
  });

  it('reports a second session with the same token hash as that rule', async () => {
    const userId = await harness().seedAccount();
    const insert = (hash: string) =>
      inUnitOfWork((unitOfWork) =>
        harness().store.insertBrowserSession(
          unitOfWork,
          contractSession(userId, hash),
        ),
      );
    await insert(HASH_A);
    await insert(HASH_B);

    const failure = await rejectionOf(insert(HASH_A));

    expect({
      constraint:
        failure instanceof UniqueConflictError ? failure.constraint : null,
      stored: (await harness().sessions(userId)).length,
    }).toEqual({ constraint: 'session.token_hash', stored: 2 });
  });
}
