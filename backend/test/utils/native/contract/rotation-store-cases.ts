import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import {
  rejectionOf,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import { NativeContractHarness } from './native-contract-harness';
import {
  NATIVE_CLIENT,
  NativeHarnessSource,
  sha256Hex,
  signInNative,
  storedToken,
} from './native-contract-support';

const LATER = new Date('2099-01-01T12:00:30.000Z');
const UNTIL = new Date('2099-01-01T12:05:00.000Z');
const KEY = 'contract-thumbprint';

/** Each guarded write of rotation and of the retry, with both its answers. */
export function rotationStoreCases(harness: NativeHarnessSource): void {
  function inWork<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    return harness().issuance.runner(rerunAtOnce).run(work);
  }

  async function family(h: NativeContractHarness, boundBy?: string) {
    const signedIn = await signInNative(h, { boundBy });
    const [access, refreshToken] = await h.credentialsOf(signedIn.sessionId);
    return { signedIn, access, refreshToken };
  }

  it('says whether a refresh token was still unspent when it was claimed', async () => {
    const store = harness().stores.rotations;
    const { signedIn, refreshToken } = await family(harness());
    const claim = (id: string) =>
      inWork((unitOfWork) => store.claimRefresh(unitOfWork, id, LATER));

    expect({
      first: await claim(refreshToken.id),
      second: await claim(refreshToken.id),
      absent: await claim(harness().absentId()),
      malformed: await rejectionOf(claim(harness().foreignId())),
      stored: await storedToken(
        harness(),
        signedIn.sessionId,
        signedIn.tokens.refreshToken,
      ),
    }).toMatchObject({
      first: 'claimed',
      second: 'already_spent',
      absent: 'already_spent',
      malformed: expect.any(MalformedIdError),
      stored: { spent: true, consumedAt: LATER, revokedAt: null },
    });
  });

  it('ends the unspent access tokens of one family and no other token', async () => {
    const store = harness().stores.rotations;
    const mine = await family(harness());
    const other = await family(harness());
    await inWork((unitOfWork) =>
      store.retireAccessTokens(unitOfWork, {
        familyId: mine.access.familyId,
        sessionId: mine.signedIn.sessionId,
        now: LATER,
      }),
    );
    const shape = async (sessionId: string) =>
      (await harness().credentialsOf(sessionId)).map(
        ({ purpose, spent, revokedAt }) => ({ purpose, spent, revokedAt }),
      );
    expect({
      mine: await shape(mine.signedIn.sessionId),
      other: await shape(other.signedIn.sessionId),
    }).toEqual({
      mine: [
        { purpose: 'native_access', spent: true, revokedAt: LATER },
        { purpose: 'native_refresh', spent: false, revokedAt: null },
      ],
      other: [
        { purpose: 'native_access', spent: false, revokedAt: null },
        { purpose: 'native_refresh', spent: false, revokedAt: null },
      ],
    });
  });

  it('names a successor only on a spent token', async () => {
    const store = harness().stores.rotations;
    const { signedIn, refreshToken } = await family(harness());
    const link = () =>
      inWork((unitOfWork) =>
        store.linkSuccessors(unitOfWork, refreshToken.id, {
          accessHash: 'next-access',
          refreshHash: 'next-refresh',
        }),
      );

    const unspent = await link();
    await inWork((unitOfWork) =>
      store.claimRefresh(unitOfWork, refreshToken.id, LATER),
    );
    expect({
      unspent,
      spent: await link(),
      stored: await storedToken(
        harness(),
        signedIn.sessionId,
        signedIn.tokens.refreshToken,
      ),
    }).toMatchObject({
      unspent: 'not_spent',
      spent: 'linked',
      stored: {
        successorAccessHash: 'next-access',
        successorRefreshHash: 'next-refresh',
      },
    });
  });

  it('gives a session its device key once', async () => {
    const store = harness().stores.rotations;
    const { signedIn } = await family(harness());
    const bind = (thumbprint: string) =>
      inWork((unitOfWork) =>
        store.bindSessionKey(unitOfWork, signedIn.sessionId, thumbprint),
      );
    expect({
      first: await bind(KEY),
      second: await bind('another-thumbprint'),
      absent: await inWork((unitOfWork) =>
        store.bindSessionKey(unitOfWork, harness().absentId(), KEY),
      ),
      stored: (await harness().session(signedIn.sessionId))?.proofKeyThumbprint,
    }).toEqual({
      first: 'bound',
      second: 'already_bound',
      absent: 'already_bound',
      stored: KEY,
    });
  });

  it('refuses a proof id that is already stored and rolls back the unit of work that offered it', async () => {
    const credentials = harness().stores.credentials;
    const { signedIn, refreshToken } = await family(harness());
    await inWork((unitOfWork) =>
      credentials.reserveProofId(unitOfWork, 'proof-hash', UNTIL),
    );
    const failure = await rejectionOf(
      inWork(async (unitOfWork) => {
        await harness().stores.rotations.claimRefresh(
          unitOfWork,
          refreshToken.id,
          LATER,
        );
        await credentials.reserveProofId(unitOfWork, 'proof-hash', UNTIL);
      }),
    );
    expect({
      failure:
        failure instanceof UniqueConflictError ? failure.constraint : failure,
      proofIds: await harness().storedProofIds(),
      token: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.refreshToken,
        )
      ).spent,
    }).toEqual({
      failure: 'native_dpop_proof_id_unique',
      proofIds: 1,
      token: false,
    });
  });

  it('reads a presented token and its session, and refuses a malformed session id', async () => {
    const credentials = harness().stores.credentials;
    const { signedIn } = await family(harness());
    const presented = await inWork((unitOfWork) =>
      credentials.findPresentedCredential(
        unitOfWork,
        sha256Hex(signedIn.tokens.refreshToken),
      ),
    );
    expect({
      presented: {
        purpose: presented?.purpose,
        sessionId: presented?.sessionId,
        clientId: presented?.clientId,
        generation: presented?.generation,
        spent: presented?.spent,
      },
      session: (
        await inWork((unitOfWork) =>
          credentials.findFamilySession(unitOfWork, signedIn.sessionId),
        )
      )?.userId,
      unknownToken: await inWork((unitOfWork) =>
        credentials.findPresentedCredential(unitOfWork, sha256Hex('none')),
      ),
      absentSession: await inWork((unitOfWork) =>
        credentials.findFamilySession(unitOfWork, harness().absentId()),
      ),
      malformedSession: await rejectionOf(
        inWork((unitOfWork) =>
          credentials.findFamilySession(unitOfWork, harness().foreignId()),
        ),
      ),
    }).toEqual({
      presented: {
        purpose: 'native_refresh',
        sessionId: signedIn.sessionId,
        clientId: NATIVE_CLIENT,
        generation: 1,
        spent: false,
      },
      session: signedIn.userId,
      unknownToken: null,
      absentSession: null,
      malformedSession: expect.any(MalformedIdError),
    });
  });
}
