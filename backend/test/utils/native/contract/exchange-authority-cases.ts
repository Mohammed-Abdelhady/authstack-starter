import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { failAfter } from '../../session/authority-contract/authority-contract-support';
import { NativeContractHarness } from './native-contract-harness';
import {
  ABORTED,
  actions,
  answerOf,
  exchange,
  NATIVE_CLIENT,
  NativeHarnessSource,
  outcomeOf,
  proofFor,
} from './native-contract-support';
import { approved, NOTHING, stored } from './exchange-support';

const INVALID_GRANT = 'invalid_grant';
/** RFC 7638 thumbprint of test key A. */
const KEY_A_THUMBPRINT = 'cCnUK5OVvBfWAvjwdXAKfKdQaxTaqMdT7QNXypbdj6E';

/** Authority lost after the approval, the device key, and a failing event. */
export function exchangeAuthorityCases(harness: NativeHarnessSource): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  it.each([
    {
      loss: 'the account signed out everywhere',
      lose: (h: NativeContractHarness, userId: string) =>
        h.issuance.bumpAccountVersion(userId),
    },
    {
      loss: 'the account was deleted',
      lose: (h: NativeContractHarness, userId: string) =>
        h.markAccountDeleted(userId),
    },
    {
      loss: 'the grant was blocked',
      lose: (h: NativeContractHarness, userId: string) =>
        h.patchGrant(userId, { allowed: false }),
    },
    {
      loss: 'the grant moved on',
      lose: (h: NativeContractHarness, userId: string) =>
        h.patchGrant(userId, { sessionVersion: 1 }),
    },
    {
      loss: 'the grant is gone',
      lose: (h: NativeContractHarness, userId: string) => h.removeGrant(userId),
    },
    {
      loss: 'the application was disabled',
      lose: (h: NativeContractHarness) =>
        h.seedNativeApplication({ enabled: false }),
    },
    {
      loss: 'the application moved on',
      lose: (h: NativeContractHarness) =>
        h.seedNativeApplication({ sessionVersion: 1 }),
    },
    {
      loss: 'the application is no longer a mobile one',
      lose: (h: NativeContractHarness) =>
        h.seedNativeApplication({ platform: 'web' }),
    },
  ])(
    'spends the code and issues nothing when $loss after the approval',
    async ({ lose }) => {
      const code = await approved(harness());
      await lose(harness(), code.userId);
      const services = harness().services();
      const first = await exchange(services, code);
      const spent = (await harness().authorization(code.transactionId))
        ?.consumed;
      await harness().seedNativeApplication();
      const second = await exchange(services, code);

      expect({
        answers: [answerOf(first), answerOf(second)],
        spent,
        stored: await stored(harness(), code.userId),
      }).toEqual({
        answers: [INVALID_GRANT, INVALID_GRANT],
        spent: true,
        stored: NOTHING,
      });
    },
  );

  it('spends the code and issues nothing when the authentication epoch moved after the approval', async () => {
    const code = await approved(harness());
    const answer = await exchange(harness().services({ authEpoch: 2 }), code);
    expect({
      answer: answerOf(answer),
      spent: (await harness().authorization(code.transactionId))?.consumed,
      stored: await stored(harness(), code.userId),
    }).toEqual({ answer: INVALID_GRANT, spent: true, stored: NOTHING });
  });

  it('binds the session and its tokens to the device key presented at the exchange', async () => {
    const code = await approved(harness());
    const result = await exchange(
      harness().services(),
      code,
      proofFor('exchange-1'),
    );
    const [session] = await harness().issuance.sessions(code.userId);
    expect({
      answer: answerOf(result),
      session: (await harness().session(session.id))?.proofKeyThumbprint,
      tokens: (await harness().credentialsOf(session.id)).map(
        ({ proofKeyThumbprint }) => proofKeyThumbprint,
      ),
      proofIds: await harness().storedProofIds(),
    }).toEqual({
      answer: 'ok',
      session: KEY_A_THUMBPRINT,
      tokens: [KEY_A_THUMBPRINT, KEY_A_THUMBPRINT],
      proofIds: 1,
    });
  });

  it('refuses a proof id used before, stores nothing of that exchange, and leaves its code usable', async () => {
    const services = harness().services();
    const first = await approved(harness());
    const second = await approved(harness());
    await exchange(services, first, proofFor('exchange-same'));

    const replayed = await exchange(
      services,
      second,
      proofFor('exchange-same'),
    );
    const afterReplay = {
      stored: await stored(harness(), second.userId),
      code: (await harness().authorization(second.transactionId))?.consumed,
      proofIds: await harness().storedProofIds(),
      refusals: (await harness().events()).filter(
        ({ action }) => action === 'native_dpop_proof_refused',
      ),
    };
    const fresh = await exchange(services, second, proofFor('exchange-new'));

    expect({
      replayed: answerOf(replayed),
      afterReplay,
      fresh: answerOf(fresh),
    }).toEqual({
      replayed: 'invalid_dpop_proof NATIVE_DPOP_PROOF_REPLAYED',
      afterReplay: {
        stored: {
          sessions: 0,
          tokens: 0,
          accountFence: 0,
          events: ['session_issued', 'native_dpop_proof_refused'],
        },
        code: false,
        proofIds: 1,
        refusals: [
          {
            action: 'native_dpop_proof_refused',
            targetUserId: second.userId,
            clientId: NATIVE_CLIENT,
            sessionId: null,
            reasonCode: 'NATIVE_DPOP_PROOF_REPLAYED',
            outcome: 'failed',
          },
        ],
      },
      fresh: 'ok',
    });
  });

  it('refuses an exchange without a device key when one is required, and one signed by a key the proof does not carry', async () => {
    const required = await approved(harness());
    const mismatched = await approved(harness());
    const missing = await exchange(
      harness().services({ dpopRequired: true }),
      required,
    );
    const forged = await exchange(
      harness().services(),
      mismatched,
      proofFor('exchange-forged', undefined, 'B').replace(/.$/, (last) =>
        last === 'A' ? 'B' : 'A',
      ),
    );
    expect({
      missing: answerOf(missing),
      forged: forged.ok ? 'ok' : forged.error,
      codes: [
        (await harness().authorization(required.transactionId))?.consumed,
        (await harness().authorization(mismatched.transactionId))?.consumed,
      ],
      refusals: (await actions(harness())).filter(
        (action) => action === 'native_dpop_proof_refused',
      ).length,
      sessions: (await stored(harness(), required.userId)).sessions,
    }).toEqual({
      missing: 'invalid_dpop_proof NATIVE_DPOP_REQUIRED',
      forged: 'invalid_dpop_proof',
      codes: [false, false],
      refusals: 2,
      sessions: 0,
    });
  });

  it('stores nothing of an exchange, and leaves the code usable, when the database refuses its event', async () => {
    const code = await approved(harness());
    const allow = await harness().issuance.refuseSecurityEvents();
    restores.push(allow);
    const outcome = await outcomeOf(exchange(harness().services(), code));
    allow();
    expect({
      outcome,
      code: (await harness().authorization(code.transactionId))?.consumed,
      stored: await stored(harness(), code.userId),
      thenWorks: answerOf(await exchange(harness().services(), code)),
    }).toEqual({
      outcome: ErrorCode.AUTHORITY_UNAVAILABLE,
      code: false,
      stored: NOTHING,
      thenWorks: 'ok',
    });
  });

  it('stores nothing of an exchange, the event included, when the work is aborted after the event', async () => {
    const code = await approved(harness());
    const restore = failAfter(
      harness().stores.events,
      'record',
      new Error(ABORTED),
    );
    restores.push(restore);
    const outcome = await outcomeOf(exchange(harness().services(), code));
    restore();
    expect({
      outcome,
      code: (await harness().authorization(code.transactionId))?.consumed,
      stored: await stored(harness(), code.userId),
    }).toEqual({
      outcome: ErrorCode.AUTHORITY_UNAVAILABLE,
      code: false,
      stored: NOTHING,
    });
  });
}
