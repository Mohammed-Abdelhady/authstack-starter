import { AuthenticatedSessions } from '../../../../src/session/authority/authenticated-session';
import { AccountNotHandedOutError } from '../../../../src/session/authority/session-authority.store';
import {
  rejectionOf,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  sessionIdOf,
} from './authority-contract-support';

const ADA = {
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  role: 'manager',
  permissions: ['posts:read:all', 'users:read:all'],
  verified: false,
};

/** Who a validated session speaks for, and what a request is handed. */
export function authorityIdentityCases(harness: AuthorityHarnessSource): void {
  it('names the account of a committed read by its stored identity', async () => {
    const userId = await harness().issuance.seedAccount();
    await harness().setAccountIdentity(userId, ADA);
    const store = harness().authorityStore;
    const account = await store.readCommittedAccount(userId);
    if (!account) throw new Error('the account was not read');

    expect(await store.describeAccount(account)).toEqual({
      id: userId,
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      role: 'manager',
      permissions: ['posts:read:all', 'users:read:all'],
      isVerified: false,
      isDeleted: false,
    });
  });

  it('answers from the read it was handed, and refuses a record it did not hand out', async () => {
    const userId = await harness().issuance.seedAccount();
    await harness().setAccountIdentity(userId, ADA);
    const store = harness().authorityStore;
    const account = await store.readCommittedAccount(userId);
    if (!account) throw new Error('the account was not read');
    await harness().setAccountIdentity(userId, { ...ADA, name: 'Renamed' });

    const held = await store.describeAccount(account);
    const rebuilt = await rejectionOf(
      store.describeAccount({
        id: userId,
        isDeleted: false,
        sessionVersion: 0,
      }),
    );
    const copied = await rejectionOf(store.describeAccount({ ...account }));

    expect({
      held: held?.name,
      rebuilt: rebuilt instanceof AccountNotHandedOutError,
      copied: copied instanceof AccountNotHandedOutError,
    }).toEqual({ held: 'Ada Lovelace', rebuilt: true, copied: true });
  });

  it('names a deactivated account as deactivated and refuses to name a stranger', async () => {
    const userId = await harness().issuance.seedAccount();
    await harness().markAccountDeleted(userId);
    const store = harness().authorityStore;
    const account = await store.readCommittedAccount(userId);
    if (!account) throw new Error('the account was not read');
    const stranger = { isDeleted: false, sessionVersion: 0 };

    expect({
      deleted: (await store.describeAccount(account))?.isDeleted,
      absent:
        (await rejectionOf(
          store.describeAccount({
            ...stranger,
            id: harness().issuance.absentAccountId(),
          }),
        )) instanceof AccountNotHandedOutError,
      foreign:
        (await rejectionOf(
          store.describeAccount({
            ...stranger,
            id: harness().issuance.foreignAccountId(),
          }),
        )) instanceof AccountNotHandedOutError,
    }).toEqual({ deleted: true, absent: true, foreign: true });
  });

  it('hands a request the session with its browser secret and its account', async () => {
    const userId = await harness().issuance.seedAccount();
    await harness().setAccountIdentity(userId, ADA);
    const issued = await harness()
      .issuance.service(rerunAtOnce)
      .createBrowserSession(userId, 'Contract/1', SIGN_IN_ADDRESS, WEB_CLIENT);
    const sessionId = await sessionIdOf(harness(), userId, issued.sessionToken);
    const sessions = new AuthenticatedSessions(harness().authorityStore);

    const authenticated = await sessions.of(
      await harness().validator().validateByToken(issued.sessionToken, false),
    );

    expect({
      id: authenticated?.id,
      userId: authenticated?.userId,
      clientId: authenticated?.clientId,
      csrfToken: authenticated?.csrfToken,
      authenticationMethods: authenticated?.authenticationMethods,
      credentialPurpose: authenticated?.credentialPurpose,
      userAgent: authenticated?.userAgent,
      storedSince: authenticated?.createdAt instanceof Date,
      user: authenticated?.user,
      nobody: await sessions.of(null),
    }).toEqual({
      id: sessionId,
      userId,
      clientId: WEB_CLIENT,
      csrfToken: issued.csrfToken,
      authenticationMethods: [],
      credentialPurpose: 'browser_session',
      userAgent: 'Contract/1',
      storedSince: true,
      user: {
        id: userId,
        email: 'ada@example.test',
        name: 'Ada Lovelace',
        role: 'manager',
        permissions: ['posts:read:all', 'users:read:all'],
        isVerified: false,
        isDeleted: false,
      },
      nobody: null,
    });
  });
}
