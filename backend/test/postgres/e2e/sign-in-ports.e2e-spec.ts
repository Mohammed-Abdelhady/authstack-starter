import * as bcrypt from 'bcrypt';
// feature:magic-link:start
import {
  MagicLinkAccounts,
  MagicLinkSignIn,
} from '../../../src/auth/magic-link/stores/magic-link-accounts';
// feature:magic-link:end
import {
  ActivationAccounts,
  ActivationSignIn,
} from '../../../src/auth/pending-codes/activation-accounts';
import { Sessions } from '../../../src/auth/services/sessions/sessions';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { createResponseMock } from '../../../src/common/testing/test-doubles.harness-spec';
import { bootE2eApp, E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
// feature:totp:start
// feature:passkeys:start
// feature:magic-link:start
import { ConfigService } from '@nestjs/config';
import {
  PasskeyAccounts,
  PasskeySignIn,
} from '../../../src/auth/passkeys/stores/passkey-accounts';
import { SecondFactorSignIn } from '../../../src/auth/two-factor/stores/second-factor-sign-in';
import { SecondFactorStore } from '../../../src/auth/two-factor/stores/second-factor.store';
import { SeedStore } from '../../../src/database/seeds/seed.store';
import { SEED_MANAGER, SEED_USER } from '../../constants/seed-users';
// feature:magic-link:end
// feature:passkeys:end
// feature:totp:end

const SID = 'sid';

/**
 * The sign-in ports of every route that finishes a sign-in, on the database
 * this run is on. Each takes the account a store handed out and nothing else.
 */
describe('the sign-in ports on the running database (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  });

  afterAll(async () => {
    await e2e?.close();
  });

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  const port = <Port>(token: abstract new (...args: never[]) => Port): Port =>
    e2e.app.get<Port>(token, { strict: false });

  /** A response that records the cookies and headers a sign-in sets. */
  function browser(agent: string) {
    const cookies: string[] = [];
    const response = createResponseMock({
      req: { headers: { 'user-agent': agent }, ip: '203.0.113.9' },
      cookie: jest.fn((name: string) => {
        cookies.push(name);
      }),
      setHeader: jest.fn(),
    });
    return { response, cookies };
  }

  const agentsOf = async (userId: string): Promise<string[]> =>
    (await port(Sessions).getUserSessions(userId)).map(
      (session) => session.userAgent,
    );

  it('signs in the account an activation stored, with a session of its own', async () => {
    const accounts = port(ActivationAccounts);
    const id = accounts.newAccountId();
    const activated = await port(UnitOfWorkRunner).run((unitOfWork) =>
      accounts.insertActivated(unitOfWork, {
        id,
        email: 'new@example.test',
        passwordHash: bcrypt.hashSync('Correct-Horse-9', 4),
        name: 'New Person',
      }),
    );
    const { response, cookies } = browser('Activation/1');

    const outcome = await port(ActivationSignIn).complete(activated, response);

    expect({ outcome, cookies, sessions: await agentsOf(id) }).toEqual({
      outcome: {
        requiresTwoFactor: false,
        user: {
          id,
          email: 'new@example.test',
          name: 'New Person',
          role: 'user',
          authProvider: 'email',
          isVerified: true,
          permissions: ['profile:read:own', 'profile:update:own'],
        },
      },
      cookies: [SID],
      sessions: ['Activation/1'],
    });
  });

  // feature:magic-link:start
  it('signs in a magic link account as the link flow left it: verified, with its role and its own permissions', async () => {
    await e2e.state.accounts.seedAccounts([
      {
        email: 'unverified@example.test',
        name: 'Not Verified Yet',
        role: 'user',
        permissions: ['users:read:all'],
        isVerified: false,
        password: bcrypt.hashSync('Correct-Horse-9', 4),
      },
    ]);
    const accounts = port(MagicLinkAccounts);
    const account = await accounts.findByEmail('unverified@example.test');
    if (!account) throw new Error('the account was not read');
    const before = account.isVerified;
    await accounts.markVerified(account);
    const { response, cookies } = browser('Link/1');

    const outcome = await port(MagicLinkSignIn).complete(account, response);

    expect({
      before,
      outcome,
      cookies,
      sessions: await agentsOf(account.id),
    }).toEqual({
      before: false,
      outcome: {
        requiresTwoFactor: false,
        user: {
          id: account.id,
          email: 'unverified@example.test',
          name: 'Not Verified Yet',
          role: 'user',
          authProvider: 'email',
          isVerified: true,
          // What the role grants, then what the account was given itself.
          permissions: [
            'profile:read:own',
            'profile:update:own',
            'users:read:all',
          ],
        },
      },
      cookies: [SID],
      sessions: ['Link/1'],
    });
  });

  it('signs in an account a magic link created', async () => {
    const created = await port(MagicLinkAccounts).createPasswordless({
      email: 'passwordless@example.test',
      name: 'Passwordless',
    });
    const { response } = browser('Link/2');

    const outcome = await port(MagicLinkSignIn).complete(created, response);

    expect({ outcome, sessions: await agentsOf(created.id) }).toEqual({
      outcome: {
        requiresTwoFactor: false,
        user: {
          id: created.id,
          email: 'passwordless@example.test',
          name: 'Passwordless',
          role: 'user',
          authProvider: 'email',
          isVerified: true,
          permissions: ['profile:read:own', 'profile:update:own'],
        },
      },
      sessions: ['Link/2'],
    });
  });
  // feature:magic-link:end

  // feature:totp:start
  // feature:passkeys:start
  // feature:magic-link:start
  // These cases need magic link, passkeys and the second factor together.
  /** 32 bytes in base64, as the deployment setting is given. */
  const FACTOR_KEY = Buffer.alloc(32, 7).toString('base64');
  const CHALLENGE = 'mfa_challenge';

  async function idOf(email: string): Promise<string> {
    const id = await port(SeedStore).findAccountId(email);
    if (!id) throw new Error(`no account for ${email}`);
    return id;
  }

  it('holds a sign-in for the second factor of an account that confirmed one, and issues no session', async () => {
    e2e.app.get(ConfigService).set('twoFactor.encryptionKey', FACTOR_KEY);
    const id = await idOf(SEED_USER.email);
    const factors = port(SecondFactorStore);
    const enrolling = await factors.findAccount(id);
    if (!enrolling) throw new Error('the account was not read');
    await factors.savePendingSecret(enrolling, {
      ciphertext: 'Y2lwaGVy',
      iv: 'aXY=',
      tag: 'dGFn',
    });
    await factors.saveConfirmation(enrolling, {
      recoveryCodeHashes: [],
      confirmedAt: TEST_NOW,
    });
    const account = await port(MagicLinkAccounts).findByEmail(SEED_USER.email);
    if (!account) throw new Error('the account was not read');
    const link = browser('Link/3');
    const passkey = browser('Passkey/3');
    const passkeyAccount = await port(PasskeyAccounts).findAccount(id);
    if (!passkeyAccount) throw new Error('the account was not read');

    const outcomes = [
      await port(MagicLinkSignIn).complete(account, link.response),
      await port(PasskeySignIn).completeSignIn(
        passkeyAccount,
        passkey.response,
      ),
    ];

    expect({
      outcomes,
      cookies: [link.cookies, passkey.cookies],
      sessions: await agentsOf(id),
    }).toEqual({
      outcomes: [{ requiresTwoFactor: true }, { requiresTwoFactor: true }],
      cookies: [[CHALLENGE], [CHALLENGE]],
      sessions: [],
    });
  });

  it('issues the session a passkey or a second factor proved, for the account that was read', async () => {
    const id = await idOf(SEED_MANAGER.email);
    const passkeyAccount = await port(PasskeyAccounts).findAccount(id);
    const factorAccount = await port(SecondFactorStore).findAccount(id);
    if (!passkeyAccount || !factorAccount) {
      throw new Error('the account was not read');
    }
    const passkey = browser('Passkey/1');
    const factor = browser('Factor/1');

    const summaries = [
      await port(PasskeySignIn).issueSession(passkeyAccount, passkey.response),
      await port(SecondFactorSignIn).issueSession(
        factorAccount,
        factor.response,
      ),
      (
        await port(PasskeySignIn).completeSignIn(
          passkeyAccount,
          browser('Passkey/2').response,
        )
      ).requiresTwoFactor,
    ];

    expect({
      summaries: summaries.map((summary) =>
        typeof summary === 'boolean'
          ? summary
          : {
              id: summary.id,
              email: summary.email,
              role: summary.role,
              isVerified: summary.isVerified,
            },
      ),
      cookies: [passkey.cookies, factor.cookies],
      sessions: (await agentsOf(id)).sort(),
    }).toEqual({
      summaries: [
        { id, email: SEED_MANAGER.email, role: 'manager', isVerified: true },
        { id, email: SEED_MANAGER.email, role: 'manager', isVerified: true },
        false,
      ],
      cookies: [[SID], [SID]],
      sessions: ['Factor/1', 'Passkey/1', 'Passkey/2'],
    });
  });

  it('signs in nothing for a record no store handed out, a copy of one included', async () => {
    const id = await idOf(SEED_USER.email);
    const passkeyAccount = await port(PasskeyAccounts).findAccount(id);
    const factorAccount = await port(SecondFactorStore).findAccount(id);
    if (!passkeyAccount || !factorAccount) {
      throw new Error('the account was not read');
    }
    const refused = (attempt: () => Promise<unknown>): Promise<string> =>
      Promise.resolve()
        .then(attempt)
        .then(
          () => 'signed in',
          () => 'refused',
        );

    const answers = [
      await refused(() =>
        port(PasskeySignIn).issueSession(
          { ...passkeyAccount },
          browser('Copy/1').response,
        ),
      ),
      await refused(() =>
        port(PasskeySignIn).completeSignIn(
          { ...passkeyAccount },
          browser('Copy/2').response,
        ),
      ),
      await refused(() =>
        port(SecondFactorSignIn).issueSession(
          { ...factorAccount },
          browser('Copy/3').response,
        ),
      ),
    ];

    expect({ answers, sessions: await agentsOf(id) }).toEqual({
      answers: ['refused', 'refused', 'refused'],
      sessions: [],
    });
  });
  // feature:magic-link:end
  // feature:passkeys:end
  // feature:totp:end
});
