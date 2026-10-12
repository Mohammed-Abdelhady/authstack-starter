import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { WEB_CLIENT } from '../../session/issuance-contract/issuance-contract-support';
import {
  begin,
  NATIVE_CLIENT,
  NativeHarnessSource,
  outcomeOf,
} from './native-contract-support';

const EXPIRED = ErrorCode.NATIVE_TRANSACTION_EXPIRED;
const PENDING_UNTIL = new Date('2099-01-01T12:05:00.000Z');
const ONE_MS_BEFORE_EXPIRY = new Date('2099-01-01T12:04:59.999Z');

/** What stops a decision: the request's expiry and the application's state. */
export function authorizationGuardCases(harness: NativeHarnessSource): void {
  it.each([
    {
      decision: 'approve',
      decide: async (h: ReturnType<NativeHarnessSource>, id: string) =>
        h.services().authorize.approve(await h.issuance.seedAccount(), id, []),
    },
    {
      decision: 'deny',
      decide: (h: ReturnType<NativeHarnessSource>, id: string) =>
        h.services().browser.deny(id),
    },
    {
      decision: 'the consent page',
      decide: async (h: ReturnType<NativeHarnessSource>, id: string) =>
        h.services().browser.getTransaction(await h.issuance.seedAccount(), id),
    },
  ])(
    'lets $decision act one millisecond before the request expires and not at its expiry, with the row still stored',
    async ({ decide }) => {
      const late = await begin(harness().services());
      const inTime = await begin(harness().services());

      harness().issuance.clock.set(PENDING_UNTIL);
      const atExpiry = await outcomeOf(decide(harness(), late.transactionId));
      harness().issuance.clock.set(ONE_MS_BEFORE_EXPIRY);
      const before = await outcomeOf(decide(harness(), inTime.transactionId));

      expect({
        atExpiry,
        before: before === EXPIRED ? EXPIRED : 'acted',
        lateStillStored: (await harness().authorization(late.transactionId))
          ?.consumed,
      }).toEqual({
        atExpiry: EXPIRED,
        before: 'acted',
        lateStillStored: false,
      });
    },
  );

  it.each([
    { change: 'disabled', patch: { enabled: false } },
    { change: 'no longer a mobile application', patch: { platform: 'web' } },
    { change: 'confidential', patch: { clientType: 'confidential' } },
    {
      change: 'registered for another return address',
      patch: { redirectUris: ['otherapp://callback'] },
    },
  ])(
    'takes no decision for an application that is now $change, and leaves the request pending',
    async ({ patch }) => {
      const services = harness().services();
      const userId = await harness().issuance.seedAccount();
      const { transactionId } = await begin(services);
      await harness().seedNativeApplication(patch);

      expect({
        approve: await outcomeOf(
          services.authorize.approve(userId, transactionId, []),
        ),
        deny: await outcomeOf(services.browser.deny(transactionId)),
        page: await outcomeOf(
          services.browser.getTransaction(userId, transactionId),
        ),
        stored: await harness().authorization(transactionId),
        grants: await harness().issuance.grants(userId),
      }).toMatchObject({
        approve: EXPIRED,
        deny: EXPIRED,
        page: EXPIRED,
        stored: { consumed: false, codeHash: null, expiresAt: PENDING_UNTIL },
        grants: [],
      });
    },
  );

  it('begins nothing for a client that is not a registered mobile application', async () => {
    const query = (clientId: string, redirect = 'myapp://callback') => ({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      state: 's',
    });
    const authorize = harness().services().authorize;
    const answers = [
      await authorize.begin(query('unregistered')),
      await authorize.begin(query(WEB_CLIENT)),
      await authorize.begin(query(NATIVE_CLIENT, 'otherapp://callback')),
      await harness()
        .services({ nativeEnabled: false })
        .authorize.begin(query(NATIVE_CLIENT)),
    ];
    expect(
      answers.map((answer) => (answer.ok ? 'begun' : answer.error)),
    ).toEqual([
      'unauthorized_client',
      'unauthorized_client',
      'invalid_request',
      'unauthorized_client',
    ]);
  });
}
