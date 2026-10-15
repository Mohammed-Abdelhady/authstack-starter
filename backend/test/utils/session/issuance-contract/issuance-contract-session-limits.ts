import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { CREDENTIAL_PURPOSE } from '../../../../src/session/constants/credential-purpose';
import { TEST_NOW } from '../../frozen-clock';
import {
  ADMIN_APPLICATION,
  ADMIN_CLIENT,
  type HarnessSource,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_APPLICATION,
  WEB_CLIENT,
} from './issuance-contract-support';

export function issuanceSessionLimitCases(harness: HarnessSource): void {
  // Failure: one application's sessions consume another application's configured slots.
  it('enforces a configured cap against its own application and clears it to the fallback', async () => {
    const h = harness();
    await h.seedApplication({ ...WEB_APPLICATION, sessionCap: 1 });
    await h.seedApplication({ ...ADMIN_APPLICATION, sessionCap: 1 });
    const userId = await h.seedAccount();
    const service = h.service(rerunAtOnce);
    const issue = (clientId: string) =>
      service.createBrowserSession(
        userId,
        'ConfiguredCap/1',
        SIGN_IN_ADDRESS,
        clientId,
      );
    await issue(ADMIN_CLIENT);
    await issue(WEB_CLIENT);
    await expect(issue(WEB_CLIENT)).rejects.toMatchObject({
      code: ErrorCode.SESSION_LIMIT_REACHED,
    });
    await expect(issue(ADMIN_CLIENT)).rejects.toMatchObject({
      code: ErrorCode.SESSION_LIMIT_REACHED,
    });
    expect(
      (await h.sessions(userId)).map(({ clientId }) => clientId).sort(),
    ).toEqual(['admin', 'web']);

    await h.seedApplication(WEB_APPLICATION);
    await issue(WEB_CLIENT);
    expect((await h.sessions(userId)).length).toBe(3);
  });

  // Failure: the persisted browser deadline ignores configured milliseconds.
  it('issues with the stored absolute and idle limits', async () => {
    const h = harness();
    await h.seedApplication({
      ...WEB_APPLICATION,
      absoluteLifetimeMs: 3_600_000,
      idleLifetimeMs: 120_000,
    });
    const userId = await h.seedAccount();
    await h
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        'ConfiguredLimits/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT,
      );
    const sessions = await h.sessions(userId);
    expect(sessions).toHaveLength(1);
    expect({
      absolute: sessions[0].expiresAt,
      idle: sessions[0].idleExpiresAt,
    }).toEqual({
      absolute: new Date('2099-01-01T13:00:00.000Z'),
      idle: new Date('2099-01-01T12:02:00.000Z'),
    });
  });

  // Failure: the PostgreSQL cap join discards the proof key and misclassifies a bound native session.
  it('carries a persisted proof-key thumbprint through cap candidate reads', async () => {
    const h = harness();
    const userId = await h.seedAccount();
    await h
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        'ProofProjection/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT,
      );
    const [session] = await h.sessions(userId);
    await h.setSessionProofKey(session.id, 'bound-device-key');
    const account = await h.account(userId);
    const candidates = await h.runner(rerunAtOnce).run((work) =>
      h.store.listSessionCapCandidates(work, {
        userId,
        userVersion: account?.sessionVersion ?? -1,
        authEpoch: 1,
        now: TEST_NOW,
        purposes: [CREDENTIAL_PURPOSE.BROWSER_SESSION],
      }),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].session.proofKeyThumbprint).toBe('bound-device-key');
  });
}
