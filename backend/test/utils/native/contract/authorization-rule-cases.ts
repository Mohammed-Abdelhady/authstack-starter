import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import {
  begin,
  codeOf,
  NATIVE_CLIENT,
  NATIVE_DISPLAY_NAME,
  NativeHarnessSource,
  outcomeOf,
  sha256Hex,
} from './native-contract-support';

const EXPIRED = ErrorCode.NATIVE_TRANSACTION_EXPIRED;
/** A request waits five minutes, a code lives one. Written out on purpose. */
const PENDING_UNTIL = new Date('2099-01-01T12:05:00.000Z');
const CODE_UNTIL = new Date('2099-01-01T12:01:00.000Z');

/** Asking for a decision, the consent page, approve and deny. */
export function authorizationRuleCases(harness: NativeHarnessSource): void {
  it('stores a request that waits five minutes for a decision', async () => {
    const begun = await begin(harness().services(), 'state-a');
    const stored = await harness().authorization(begun.transactionId);
    expect({ ...stored, id: typeof stored?.id }).toEqual({
      id: 'string',
      consumed: false,
      codeHash: null,
      expiresAt: PENDING_UNTIL,
      codeExpiresAt: null,
      userId: null,
      state: 'state-a',
      requestedScopes: ['api'],
      authEpoch: 1,
      authenticationMethods: [],
      capturedUserVersion: null,
      capturedClientVersion: null,
      capturedGrantVersion: null,
    });
  });

  it('describes a pending request to the consent page, and says when access was granted before', async () => {
    const services = harness().services();
    const granted = await harness().issuance.seedAccount();
    const blocked = await harness().issuance.seedAccount();
    const fresh = await harness().issuance.seedAccount();
    await services.authorize.approve(
      granted,
      (await begin(services)).transactionId,
      [],
    );
    await harness().issuance.seedBlockedGrant(blocked, NATIVE_CLIENT);
    const { transactionId } = await begin(services);

    const page = (userId: string) =>
      services.browser.getTransaction(userId, transactionId);
    expect([
      await page(fresh),
      await page(granted),
      await page(blocked),
    ]).toEqual(
      [false, true, false].map((alreadyGranted) => ({
        applicationName: NATIVE_DISPLAY_NAME,
        platform: 'native',
        expiresAt: '2099-01-01T12:05:00.000Z',
        alreadyGranted,
      })),
    );
  });

  it('approves a request with a code, the account, the captured versions and an allowed grant', async () => {
    await harness().seedNativeApplication({ sessionVersion: 3 });
    const services = harness().services();
    const userId = await harness().issuance.seedAccount();
    await harness().issuance.bumpAccountVersion(userId);
    const begun = await begin(services, 'state-b');
    const twelve = Array.from({ length: 12 }, (_, index) => `m${index}`);

    const approved = await services.authorize.approve(
      userId,
      begun.transactionId,
      twelve,
    );
    const target = new URL(approved.redirectUri);
    const stored = await harness().authorization(begun.transactionId);
    expect({
      callback: `${target.protocol}//${target.host}`,
      state: target.searchParams.get('state'),
      stored: { ...stored, id: 'x' },
      grants: (await harness().issuance.grants(userId)).map(
        ({ clientId, allowed, issuanceFence }) => ({
          clientId,
          allowed,
          issuanceFence,
        }),
      ),
    }).toEqual({
      callback: 'myapp://callback',
      state: 'state-b',
      stored: {
        id: 'x',
        consumed: false,
        codeHash: sha256Hex(codeOf(approved.redirectUri)),
        expiresAt: CODE_UNTIL,
        codeExpiresAt: CODE_UNTIL,
        userId,
        state: 'state-b',
        requestedScopes: ['api'],
        authEpoch: 1,
        authenticationMethods: twelve.slice(0, 10),
        capturedUserVersion: 1,
        capturedClientVersion: 3,
        capturedGrantVersion: 0,
      },
      grants: [{ clientId: NATIVE_CLIENT, allowed: true, issuanceFence: 0 }],
    });
  });

  it('approves with the grant the account already has, and refuses a blocked one whole', async () => {
    const services = harness().services();
    const returning = await harness().issuance.seedAccount();
    const blocked = await harness().issuance.seedAccount();
    await services.authorize.approve(
      returning,
      (await begin(services)).transactionId,
      [],
    );
    await harness().issuance.seedBlockedGrant(blocked, NATIVE_CLIENT);
    const again = await begin(services);
    const refused = await begin(services);

    await services.authorize.approve(returning, again.transactionId, []);
    const outcome = await outcomeOf(
      services.authorize.approve(blocked, refused.transactionId, []),
    );
    expect({
      returningGrants: (await harness().issuance.grants(returning)).length,
      outcome,
      refusedCode: (await harness().authorization(refused.transactionId))
        ?.codeHash,
      refusedStillPending:
        (await outcomeOf(services.browser.deny(refused.transactionId))) !==
        EXPIRED,
    }).toEqual({
      returningGrants: 1,
      outcome: ErrorCode.GRANT_BLOCKED,
      refusedCode: null,
      refusedStillPending: true,
    });
  });

  it('refuses an approval that names no request, no account, or a malformed one', async () => {
    const services = harness().services();
    const userId = await harness().issuance.seedAccount();
    const deleted = await harness().issuance.seedAccount({ deleted: true });
    const { transactionId } = await begin(services);
    const approve = (user: string, id: string) =>
      outcomeOf(services.authorize.approve(user, id, []));

    expect({
      unknownRequest: await approve(userId, 'no-such-request'),
      blankRequest: await approve(userId, '   '),
      deletedAccount: await approve(deleted, transactionId),
      absentAccount: await approve(harness().absentId(), transactionId),
      malformedAccount: await approve(harness().foreignId(), transactionId),
      disabled: await outcomeOf(
        harness()
          .services({ nativeEnabled: false })
          .authorize.approve(userId, transactionId, []),
      ),
      stillPending: (await harness().authorization(transactionId))?.codeHash,
    }).toEqual({
      unknownRequest: EXPIRED,
      blankRequest: ErrorCode.VALIDATION_ERROR,
      deletedAccount: ErrorCode.USER_NOT_FOUND,
      absentAccount: ErrorCode.USER_NOT_FOUND,
      malformedAccount: ErrorCode.VALIDATION_ERROR,
      disabled: ErrorCode.NATIVE_AUTH_DISABLED,
      stillPending: null,
    });
  });

  it('denies a request once, and a decided request takes no second decision', async () => {
    const services = harness().services();
    const userId = await harness().issuance.seedAccount();
    const denied = await begin(services, 'state-d');
    const approved = await begin(services);

    const denial = await services.browser.deny(denied.transactionId);
    const approval = await services.authorize.approve(
      userId,
      approved.transactionId,
      [],
    );
    const codeHash = sha256Hex(codeOf(approval.redirectUri));
    expect({
      denial: denial.redirectUri,
      denyAgain: await outcomeOf(services.browser.deny(denied.transactionId)),
      approveDenied: await outcomeOf(
        services.authorize.approve(userId, denied.transactionId, []),
      ),
      pageOfDenied: await outcomeOf(
        services.browser.getTransaction(userId, denied.transactionId),
      ),
      denyApproved: await outcomeOf(
        services.browser.deny(approved.transactionId),
      ),
      approveAgain: await outcomeOf(
        services.authorize.approve(userId, approved.transactionId, []),
      ),
      deniedStored: (await harness().authorization(denied.transactionId))
        ?.codeHash,
      approvedStored: await harness().authorization(approved.transactionId),
    }).toMatchObject({
      denial: 'myapp://callback?error=access_denied&state=state-d',
      denyAgain: EXPIRED,
      approveDenied: EXPIRED,
      pageOfDenied: EXPIRED,
      denyApproved: EXPIRED,
      approveAgain: EXPIRED,
      deniedStored: null,
      approvedStored: { consumed: false, codeHash },
    });
  });
}
