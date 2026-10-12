import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { TEST_NOW } from '../../frozen-clock';
import {
  rejectionOf,
  rerunAtOnce,
  SESSION_CAP,
  signInTimes,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  answerOf,
  ApprovedCode,
  exchange,
  NATIVE_CLIENT,
  NATIVE_META,
  NativeHarnessSource,
  sha256Hex,
} from './native-contract-support';
import { approved, NOTHING, stored } from './exchange-support';

const INVALID_GRANT = 'invalid_grant';
/** Thirty days, and five minutes, from the frozen noon. Written out on purpose. */
const ABSOLUTE = new Date('2099-01-31T12:00:00.000Z');
const FIVE_PAST = new Date('2099-01-01T12:05:00.000Z');
const CODE_EXPIRY = new Date('2099-01-01T12:01:00.000Z');
const ONE_MS_BEFORE_CODE_EXPIRY = new Date('2099-01-01T12:00:59.999Z');
/** RFC 7638 thumbprint of test key A. */

/** Exchanging a code for the first session and its token pair. */
export function exchangeCases(harness: NativeHarnessSource): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  it('exchanges a code for a session and one pair of tokens', async () => {
    const code = await approved(harness());
    const result = await exchange(harness().services(), code);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const [session] = await harness().issuance.sessions(code.userId);
    const tokens = await harness().credentialsOf(session.id);

    expect({
      answer: {
        expiresIn: result.expiresIn,
        scope: result.scope,
        tokenType: result.tokenType,
      },
      session: await harness().session(session.id),
      device: session.device,
      tokens: tokens.map((token) => ({
        hashIsThe:
          token.tokenHash === sha256Hex(result.accessToken)
            ? 'access token'
            : token.tokenHash === sha256Hex(result.refreshToken)
              ? 'refresh token'
              : 'neither',
        purpose: token.purpose,
        generation: token.generation,
        sameFamily: token.familyId === tokens[0].familyId,
        expiresAt: token.expiresAt,
        spent: token.spent,
        revokedAt: token.revokedAt,
        proofKeyThumbprint: token.proofKeyThumbprint,
      })),
      code: (await harness().authorization(code.transactionId))?.consumed,
      stored: await stored(harness(), code.userId),
      events: await harness().events(),
    }).toEqual({
      answer: { expiresIn: 300, scope: 'api', tokenType: 'Bearer' },
      session: {
        isValid: true,
        revokedAt: null,
        revokedReason: null,
        credentialPurpose: 'native_access',
        proofKeyThumbprint: null,
        userVersion: 0,
        clientVersion: 0,
        grantVersion: 0,
        scopes: ['api'],
        authenticationMethods: ['password'],
        expiresAt: ABSOLUTE,
        idleExpiresAt: FIVE_PAST,
      },
      device: {
        type: 'desktop',
        browser: 'Unknown Browser',
        os: 'Unknown OS',
        name: 'Unknown device',
      },
      tokens: [
        {
          hashIsThe: 'access token',
          purpose: 'native_access',
          generation: 1,
          sameFamily: true,
          expiresAt: FIVE_PAST,
          spent: false,
          revokedAt: null,
          proofKeyThumbprint: null,
        },
        {
          hashIsThe: 'refresh token',
          purpose: 'native_refresh',
          generation: 1,
          sameFamily: true,
          expiresAt: ABSOLUTE,
          spent: false,
          revokedAt: null,
          proofKeyThumbprint: null,
        },
      ],
      code: true,
      stored: {
        sessions: 1,
        tokens: 2,
        accountFence: 1,
        events: ['session_issued'],
      },
      events: [
        {
          action: 'session_issued',
          targetUserId: code.userId,
          clientId: NATIVE_CLIENT,
          sessionId: session.id,
          reasonCode: null,
          outcome: 'succeeded',
        },
      ],
    });
  });

  it('exchanges a code once', async () => {
    const code = await approved(harness());
    const services = harness().services();
    const first = await exchange(services, code);
    const second = await exchange(services, code);
    expect({
      answers: [answerOf(first), answerOf(second)],
      stored: await stored(harness(), code.userId),
    }).toEqual({
      answers: ['ok', INVALID_GRANT],
      stored: {
        sessions: 1,
        tokens: 2,
        accountFence: 1,
        events: ['session_issued'],
      },
    });
  });

  it('leaves a code usable after the wrong client or return address, and spends it on the wrong verifier', async () => {
    const services = harness().services();
    const kept = await approved(harness());
    const spent = await approved(harness());
    const grant = (code: ApprovedCode, override: Record<string, string>) =>
      services.tokens.grant(
        {
          grant_type: 'authorization_code',
          code: code.code,
          redirect_uri: 'myapp://callback',
          client_id: NATIVE_CLIENT,
          code_verifier: code.verifier,
          ...override,
        },
        NATIVE_META,
      );

    expect({
      otherClient: answerOf(await grant(kept, { client_id: 'web' })),
      otherAddress: answerOf(
        await grant(kept, { redirect_uri: 'otherapp://callback' }),
      ),
      keptThenWorks: answerOf(await grant(kept, {})),
      wrongVerifier: answerOf(
        await grant(spent, { code_verifier: 'w'.repeat(43) }),
      ),
      spentThenFails: answerOf(await grant(spent, {})),
      spentStored: (await harness().authorization(spent.transactionId))
        ?.consumed,
      nothingForSpent: await stored(harness(), spent.userId),
    }).toEqual({
      otherClient: INVALID_GRANT,
      otherAddress: INVALID_GRANT,
      keptThenWorks: 'ok',
      wrongVerifier: INVALID_GRANT,
      spentThenFails: INVALID_GRANT,
      spentStored: true,
      nothingForSpent: { ...NOTHING, events: ['session_issued'] },
    });
  });

  it('exchanges one millisecond before the code expires and not at its expiry, with the row still stored', async () => {
    const late = await approved(harness());
    const inTime = await approved(harness());
    const services = harness().services();

    harness().issuance.clock.set(CODE_EXPIRY);
    const atExpiry = await exchange(services, late);
    harness().issuance.clock.set(ONE_MS_BEFORE_CODE_EXPIRY);
    const before = await exchange(services, inTime);

    expect({
      atExpiry: answerOf(atExpiry),
      before: answerOf(before),
      lateRow: (await harness().authorization(late.transactionId))?.consumed,
      lateStored: (await stored(harness(), late.userId)).sessions,
    }).toEqual({
      atExpiry: INVALID_GRANT,
      before: 'ok',
      lateRow: false,
      lateStored: 0,
    });
  });

  it('refuses a code at a full session cap, stores nothing, and exchanges the same code once a slot is free', async () => {
    const code = await approved(harness());
    await signInTimes(
      harness().issuance.service(rerunAtOnce),
      code.userId,
      SESSION_CAP,
    );
    const services = harness().services();
    const full = await exchange(services, code);
    const whenFull = {
      code: (await harness().authorization(code.transactionId))?.consumed,
      fence: (await harness().issuance.account(code.userId))?.issuanceFence,
      sessions: (await harness().issuance.sessions(code.userId)).length,
    };
    await harness().issuance.revokeOneSession(code.userId);
    const freed = await exchange(services, code);

    expect({
      full: answerOf(full),
      whenFull,
      freed: answerOf(freed),
      fence: (await harness().issuance.account(code.userId))?.issuanceFence,
    }).toEqual({
      full: 'access_denied',
      whenFull: { code: false, fence: 20, sessions: 20 },
      freed: 'ok',
      fence: 21,
    });
  });

  it('says whether a code was still unspent, and reads only codes that can be exchanged', async () => {
    const store = harness().stores.authorizations;
    const code = await approved(harness());
    const row = await harness().authorization(code.transactionId);
    if (!row) {
      throw new Error('the approval stored nothing');
    }
    const hash = sha256Hex(code.code);
    const inWork = <Result>(
      work: (unitOfWork: UnitOfWork) => Promise<Result>,
    ) => harness().issuance.runner(rerunAtOnce).run(work);

    const before = {
      byHash: (await store.findUnspentCode(hash))?.id === row.id,
      holder: await store.findCodeHolder(hash, TEST_NOW),
      holderAtExpiry: await store.findCodeHolder(hash, CODE_EXPIRY),
      unknown: await store.findUnspentCode(sha256Hex('no such code')),
    };
    const spends = [
      await inWork((unitOfWork) => store.spendCodeIn(unitOfWork, row.id)),
      await inWork((unitOfWork) => store.spendCodeIn(unitOfWork, row.id)),
      await store.spendCode(row.id),
      await store.spendCode(harness().absentId()),
    ];
    expect({
      before,
      spends,
      after: {
        byHash: await store.findUnspentCode(hash),
        holder: await store.findCodeHolder(hash, TEST_NOW),
        inWork: await inWork((unitOfWork) =>
          store.findUnspentCodeIn(unitOfWork, row.id),
        ),
      },
      malformed: [
        await rejectionOf(store.spendCode(harness().foreignId())),
        await rejectionOf(
          inWork((unitOfWork) =>
            store.findUnspentCodeIn(unitOfWork, harness().foreignId()),
          ),
        ),
      ],
    }).toEqual({
      before: {
        byHash: true,
        holder: { clientId: NATIVE_CLIENT, userId: code.userId },
        holderAtExpiry: null,
        unknown: null,
      },
      spends: ['spent', 'already_spent', 'already_spent', 'already_spent'],
      after: { byHash: null, holder: null, inWork: null },
      malformed: [expect.any(MalformedIdError), expect.any(MalformedIdError)],
    });
  });
}
