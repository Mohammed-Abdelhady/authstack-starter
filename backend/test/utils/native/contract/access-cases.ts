import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { TEST_NOW } from '../../frozen-clock';
import { holdBefore } from '../../race-gate';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  granted,
  NativeHarnessSource,
  outcomeOf,
  refresh,
  sha256Hex,
  signInNative,
  storedToken,
} from './native-contract-support';
import { nativeRaceTools } from './native-race-support';

const THREE_PAST = new Date('2099-01-01T12:03:00.000Z');
const ONE_MS_BEFORE_THREE_PAST = new Date('2099-01-01T12:02:59.999Z');
const ONE_SECOND_ON = new Date('2099-01-01T12:00:01.000Z');

/** Validating a mobile access token, and marking its first use. */
export function accessCases(harness: NativeHarnessSource): void {
  const { gate, restoreLater } = nativeRaceTools();

  it('validates a live access token and names its session and account', async () => {
    const signedIn = await signInNative(harness());
    const access = harness().services().access;
    const validated = await access.validate(signedIn.tokens.accessToken);
    expect({
      session: validated?.session.id,
      account: validated?.account,
      unknown: await access.validate('no-such-token'),
      refreshToken: await access.validate(signedIn.tokens.refreshToken),
      disabled: await outcomeOf(
        harness()
          .services({ nativeEnabled: false })
          .access.validate(signedIn.tokens.accessToken),
      ),
      firstUse: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.accessToken,
        )
      ).firstUsedAt,
    }).toEqual({
      session: signedIn.sessionId,
      account: { id: signedIn.userId, isDeleted: false, sessionVersion: 0 },
      unknown: null,
      refreshToken: null,
      disabled: ErrorCode.NATIVE_AUTH_DISABLED,
      firstUse: null,
    });
  });

  it('validates one millisecond before the access token expires and not at its expiry, with the row still stored', async () => {
    const signedIn = await signInNative(harness());
    await harness().patchCredential(sha256Hex(signedIn.tokens.accessToken), {
      expiresAt: THREE_PAST,
    });
    const access = harness().services().access;

    harness().issuance.clock.set(ONE_MS_BEFORE_THREE_PAST);
    const before = await access.validate(signedIn.tokens.accessToken);
    harness().issuance.clock.set(THREE_PAST);
    const atExpiry = await access.validate(signedIn.tokens.accessToken);

    expect({
      before: before?.session.id,
      atExpiry,
      stored: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.accessToken,
        )
      ).spent,
    }).toEqual({ before: signedIn.sessionId, atExpiry: null, stored: false });
  });

  it('refuses an access token that was replaced, and one whose session was signed out', async () => {
    const replaced = await signInNative(harness());
    const signedOut = await signInNative(harness());
    const services = harness().services();
    const next = granted(await refresh(services, replaced.tokens.refreshToken));
    await harness().revokeSession(signedOut.sessionId);

    expect({
      replaced: await services.access.validate(replaced.tokens.accessToken),
      successor: (await services.access.validate(next.accessToken))?.session.id,
      signedOut: await services.access.validate(signedOut.tokens.accessToken),
    }).toEqual({
      replaced: null,
      successor: replaced.sessionId,
      signedOut: null,
    });
  });

  it('marks the first use of a token bound to a device key, once, and keeps validating it', async () => {
    const signedIn = await signInNative(harness(), { boundBy: 'access-x' });
    const access = harness().services().access;
    const firstUse = async () =>
      (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.accessToken,
        )
      ).firstUsedAt;

    const first = await access.validate(signedIn.tokens.accessToken);
    const afterFirst = await firstUse();
    harness().issuance.clock.set(ONE_SECOND_ON);
    const second = await access.validate(signedIn.tokens.accessToken);

    expect({
      first: first?.session.id,
      afterFirst,
      second: second?.session.id,
      afterSecond: await firstUse(),
    }).toEqual({
      first: signedIn.sessionId,
      afterFirst: TEST_NOW,
      second: signedIn.sessionId,
      afterSecond: TEST_NOW,
    });
  });

  it('says whether a first use was marked, and whether a token is still live', async () => {
    const store = harness().stores.access;
    const signedIn = await signInNative(harness());
    const spent = await signInNative(harness());
    granted(await refresh(harness().services(), spent.tokens.refreshToken));
    const [access] = await harness().credentialsOf(signedIn.sessionId);
    const [spentAccess] = await harness().credentialsOf(spent.sessionId);
    const accessHash = sha256Hex(signedIn.tokens.accessToken);
    const atExpiry = access.expiresAt;
    const oneMsBefore = new Date(atExpiry.getTime() - 1);

    expect({
      read: await store.readCommittedAccessCredential(accessHash, TEST_NOW),
      readAtExpiry: await store.readCommittedAccessCredential(
        accessHash,
        atExpiry,
      ),
      readRefresh: await store.readCommittedAccessCredential(
        sha256Hex(signedIn.tokens.refreshToken),
        TEST_NOW,
      ),
      readSpent: await store.readCommittedAccessCredential(
        sha256Hex(spent.tokens.accessToken),
        TEST_NOW,
      ),
      marks: [
        await store.markFirstUse(access.id, TEST_NOW),
        await store.markFirstUse(access.id, ONE_SECOND_ON),
        await store.markFirstUse(spentAccess.id, TEST_NOW),
        await store.markFirstUse(harness().absentId(), TEST_NOW),
      ],
      live: [
        await store.readCommittedAccessIsLive(access.id, oneMsBefore),
        await store.readCommittedAccessIsLive(access.id, atExpiry),
        await store.readCommittedAccessIsLive(spentAccess.id, TEST_NOW),
        await store.readCommittedAccessIsLive(harness().absentId(), TEST_NOW),
      ],
      firstUse: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.accessToken,
        )
      ).firstUsedAt,
      spentFirstUse: (
        await storedToken(harness(), spent.sessionId, spent.tokens.accessToken)
      ).firstUsedAt,
      malformed: await rejectionOf(
        store.markFirstUse(harness().foreignId(), TEST_NOW),
      ),
    }).toEqual({
      read: {
        id: access.id,
        sessionId: signedIn.sessionId,
        proofKeyThumbprint: null,
      },
      readAtExpiry: null,
      readRefresh: null,
      readSpent: null,
      marks: ['marked', 'not_marked', 'not_marked', 'not_marked'],
      live: [true, false, false, false],
      firstUse: TEST_NOW,
      spentFirstUse: null,
      malformed: expect.any(MalformedIdError),
    });
  });

  it('refuses a bound token whose family ended between its read and its first-use mark', async () => {
    const signedIn = await signInNative(harness(), { boundBy: 'access-y' });
    const services = harness().services();
    const beforeTheMark = gate();
    restoreLater(
      holdBefore(harness().stores.access, 'markFirstUse', (call) =>
        call === 0 ? beforeTheMark : undefined,
      ),
    );

    const validating = services.access.validate(signedIn.tokens.accessToken);
    await beforeTheMark.reached(1);
    const signedOut = await services.signOut.revokeNativeSession(
      signedIn.sessionId,
      signedIn.userId,
    );
    beforeTheMark.release();

    expect({
      signedOut,
      validated: await validating,
      firstUse: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.accessToken,
        )
      ).firstUsedAt,
    }).toEqual({ signedOut: true, validated: null, firstUse: null });
  });
}
