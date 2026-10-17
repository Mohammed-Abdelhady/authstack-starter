import { CREDENTIAL_PURPOSE } from '../../../../src/session/constants/credential-purpose';
import { RaceGate, holdBefore } from '../../race-gate';
import { WEB_APPLICATION } from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  failAfter,
  signIn,
  validates,
} from './authority-contract-support';

const SIX_MINUTES_IN = new Date('2099-01-01T12:06:00.000Z');
const FIVE_MINUTES_MS = 300_000;
const TWENTY_MINUTES_MS = 1_200_000;

export function authorityLiveLimitCases(harness: AuthorityHarnessSource): void {
  let restores: Array<() => void> = [];
  let gates: RaceGate[] = [];

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  async function shortenedSession() {
    const h = harness();
    const userId = await h.issuance.seedAccount();
    const signedIn = await signIn(h, userId);
    await h.issuance.seedApplication({
      ...WEB_APPLICATION,
      idleLifetimeMs: FIVE_MINUTES_MS,
    });
    h.issuance.clock.set(SIX_MINUTES_IN);
    return { ...signedIn, userId };
  }

  it('persists a shortened idle expiry and never revives it after lengthening', async () => {
    const { token, sessionId } = await shortenedSession();
    await harness().patchSession(sessionId, { revokedAt: null });
    expect(await validates(harness(), token)).toBe(false);
    expect(await harness().session(sessionId)).toMatchObject({
      isValid: false,
      revokedAt: SIX_MINUTES_IN,
      revokedReason: 'expired',
    });
    await harness().issuance.seedApplication({
      ...WEB_APPLICATION,
      idleLifetimeMs: TWENTY_MINUTES_MS,
    });
    expect(await validates(harness(), token)).toBe(false);
    expect(
      (await harness().events()).filter(
        (event) => event.reasonCode === 'expired',
      ),
    ).toEqual([
      expect.objectContaining({
        action: 'session_revoked',
        clientId: WEB_APPLICATION.clientId,
        sessionId,
      }),
    ]);
  });

  it('persists a shortened absolute expiry despite recent activity', async () => {
    const h = harness();
    const userId = await h.issuance.seedAccount();
    const { token, sessionId } = await signIn(h, userId);
    await h.patchSession(sessionId, {
      lastActivityAt: new Date('2099-01-01T13:09:00.000Z'),
      idleExpiresAt: new Date('2099-01-01T13:19:00.000Z'),
    });
    await h.issuance.seedApplication({
      ...WEB_APPLICATION,
      absoluteLifetimeMs: 3_600_000,
    });
    h.issuance.clock.set(new Date('2099-01-01T13:10:00.000Z'));
    expect(await validates(h, token)).toBe(false);
    expect(await h.session(sessionId)).toMatchObject({
      isValid: false,
      revokedReason: 'expired',
    });
  });

  it('ends an expired session found while listing and keeps it ended', async () => {
    const { userId, sessionId } = await shortenedSession();
    expect(await harness().validator().listActive(userId)).toEqual([]);
    await harness().issuance.seedApplication({
      ...WEB_APPLICATION,
      idleLifetimeMs: TWENTY_MINUTES_MS,
    });
    expect(await harness().validator().listActive(userId)).toEqual([]);
    expect(await harness().session(sessionId)).toMatchObject({
      isValid: false,
      revokedReason: 'expired',
    });
  });

  it('keeps the expired reply when persistence fails and retries at the next use', async () => {
    const { token, sessionId, userId } = await shortenedSession();
    const restore = failAfter(
      harness().revocationStore,
      'appendSecurityEvent',
      new Error('expiry event could not commit'),
    );
    restores.push(restore);
    expect(
      await harness().validator().validateByToken(token, false),
    ).toBeNull();
    expect(await harness().validator().listActive(userId)).toEqual([]);
    expect(await harness().session(sessionId)).toMatchObject({
      isValid: true,
      revokedAt: null,
    });
    expect(
      (await harness().events()).filter(
        (event) => event.reasonCode === 'expired',
      ),
    ).toEqual([]);
    restore();
    expect(await validates(harness(), token)).toBe(false);
    expect(await harness().session(sessionId)).toMatchObject({
      isValid: false,
      revokedReason: 'expired',
    });
  });

  it('refuses a grant-version mismatch without waiting on revocation', async () => {
    const h = harness();
    const userId = await h.issuance.seedAccount();
    const { token, sessionId } = await signIn(h, userId);
    await h.patchSession(sessionId, { grantVersion: 1 });
    const revocation = new RaceGate();
    gates.push(revocation);
    restores.push(
      holdBefore(
        h.revocationStore,
        'readAccountForRevocation',
        () => revocation,
      ),
    );
    const pending = h.validator().validateByToken(token, false);
    try {
      expect(
        await Promise.race([
          pending,
          revocation.reached().then(() => 'waited on revocation'),
        ]),
      ).toBeNull();
    } finally {
      revocation.release();
      await pending;
    }
    expect(await h.session(sessionId)).toMatchObject({
      isValid: true,
      revokedAt: null,
    });
  });

  it('respects an idle extension committed before the expiry lock is taken', async () => {
    const { token, sessionId } = await shortenedSession();
    const gate = new RaceGate();
    gates.push(gate);
    restores.push(
      holdBefore(harness().revocationStore, 'findSessionOfAccount', () => gate),
    );
    const pending = harness().validator().validateByToken(token, false);
    try {
      await gate.reached();
      await harness().patchSession(sessionId, {
        lastActivityAt: SIX_MINUTES_IN,
        idleExpiresAt: new Date('2099-01-01T12:11:00.000Z'),
      });
    } finally {
      gate.release();
    }
    await pending;
    expect(await validates(harness(), token)).toBe(true);
    expect(await harness().session(sessionId)).toMatchObject({
      isValid: true,
      revokedAt: null,
    });
  });

  it('validates an unbound native session against its current unbound limits', async () => {
    const h = harness();
    const userId = await h.issuance.seedAccount();
    const { sessionId } = await signIn(h, userId);
    await h.issuance.seedApplication({
      ...WEB_APPLICATION,
      platform: 'native',
      unboundAbsoluteLifetimeMs: 7_200_000,
      unboundIdleLifetimeMs: FIVE_MINUTES_MS,
    });
    await h.patchSession(sessionId, {
      credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      proofKeyThumbprint: null,
    });
    h.issuance.clock.set(SIX_MINUTES_IN);
    expect(await h.validator().validateById(sessionId, false)).toBeNull();
    expect(await h.session(sessionId)).toMatchObject({
      isValid: false,
      revokedReason: 'expired',
    });
  });
}
