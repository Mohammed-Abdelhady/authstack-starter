import { holdAddress } from '../../../../test/utils/address-claim';
import { SwitchableAccountCreationPolicy } from '../../../../test/utils/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { WEB_CLIENT_ID } from '../../../session/constants/client-ids';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  LINK_REQUEST,
  LINK_RESPONSE,
  linkServices,
  LinkServices,
  MagicLinkHarnessSource,
  refusalOf,
  useOutcome,
} from './magic-link-contract.harness-spec';

const EMAIL = 'link@example.test';
const TOKEN = 'a-token-from-the-mailed-link';
const INVALID = 'MAGIC_LINK_INVALID';
const LINK_EXPIRY = new Date('2099-01-01T12:15:00.000Z');

/** Spending a link once, and the account it signs in. */
export function magicLinkVerifyCases(harness: MagicLinkHarnessSource): void {
  let services: LinkServices;
  let policy: SwitchableAccountCreationPolicy;

  beforeEach(() => {
    policy = new SwitchableAccountCreationPolicy(
      harness().issuanceApplications,
    );
    services = linkServices(harness(), policy);
  });

  const verify = (token = TOKEN) =>
    services.service.verify(
      { token, confirm: true },
      LINK_REQUEST,
      LINK_RESPONSE,
    );
  const seedLink = (
    overrides: {
      tokenHash?: string;
      expiresAt?: Date;
      createdAt?: Date;
      consumedAt?: Date;
      redirect?: string;
    } = {},
  ) =>
    harness().seedLink({
      email: EMAIL,
      tokenHash: hashMagicLinkToken(TOKEN),
      expiresAt: LINK_EXPIRY,
      createdAt: TEST_NOW,
      ...overrides,
    });

  it('spends a link once and signs its owner in', async () => {
    const accountId = await harness().seedAccount({
      email: EMAIL,
      isVerified: true,
      isDeleted: false,
    });
    await seedLink({ redirect: '/en/auth/native/authorize?transaction=abc' });

    const first = await verify();
    const second = await refusalOf(verify());
    expect(policy.calls).toEqual([]);

    expect({
      user: first.data.user?.id,
      redirect: first.data.redirect,
      second,
      signedIn: services.signedIn,
      spentAt: (await harness().link(hashMagicLinkToken(TOKEN)))?.consumedAt,
    }).toEqual({
      user: accountId,
      redirect: '/en/auth/native/authorize?transaction=abc',
      second: INVALID,
      signedIn: [accountId],
      spentAt: TEST_NOW,
    });
  });

  it('lets one of two simultaneous uses of one link sign in', async () => {
    await harness().seedAccount({
      email: EMAIL,
      isVerified: true,
      isDeleted: false,
    });
    await seedLink();
    const gate = new RaceGate();
    const restore = holdBefore(harness().links, 'claimLink', () => gate);
    let outcomes: string[];
    try {
      const both = [verify(), verify()].map(useOutcome);
      await gate.reached(2);
      gate.release();
      outcomes = await Promise.all(both);
    } finally {
      restore();
    }

    expect({
      outcomes: outcomes.sort(),
      signIns: services.signedIn.length,
    }).toEqual({ outcomes: [INVALID, 'signed in'], signIns: 1 });
  });

  it('refuses a link that expired at this instant though its row is still stored, and creates no account', async () => {
    await seedLink({ expiresAt: TEST_NOW });

    const refusal = await refusalOf(verify());

    expect({
      refusal,
      signIns: services.signedIn.length,
      accounts: await harness().accountCount(),
      links: await harness().linkCount(),
    }).toEqual({
      refusal: INVALID,
      signIns: 0,
      accounts: 0,
      links: 1,
    });
  });

  it('accepts a link one millisecond before it expires', async () => {
    await seedLink({ expiresAt: new Date(TEST_NOW.getTime() + 1) });

    const answer = await verify();

    expect(answer.data.requiresTwoFactor).toBe(false);
  });

  it('refuses a token no link was stored for', async () => {
    await seedLink();

    expect(await refusalOf(verify('another-token'))).toBe(INVALID);
  });

  it('creates a verified account for a new address and signs it in', async () => {
    const creating = jest.spyOn(harness().accounts, 'createPasswordlessIn');
    await harness().seedLink({
      email: 'new.person@example.test',
      tokenHash: hashMagicLinkToken(TOKEN),
      expiresAt: LINK_EXPIRY,
      createdAt: TEST_NOW,
    });

    await verify();
    const account = await harness().account('new.person@example.test');
    expect(policy.calls).toEqual([
      {
        request: {
          application: WEB_CLIENT_ID,
          method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
        },
        unitOfWork: creating.mock.calls[0]?.[0],
      },
    ]);
    creating.mockRestore();

    expect({
      account: account && {
        name: account.name,
        isVerified: account.isVerified,
        isDeleted: account.isDeleted,
        authProvider: account.authProvider,
      },
      signedIn: services.signedIn,
    }).toEqual({
      account: {
        name: 'new person',
        isVerified: true,
        isDeleted: false,
        authProvider: 'email',
      },
      signedIn: [account?.id],
    });
  });

  it('verifies an account that had not confirmed its address', async () => {
    await harness().seedAccount({
      email: EMAIL,
      isVerified: false,
      isDeleted: false,
    });
    await seedLink();

    await verify();

    expect({
      isVerified: (await harness().account(EMAIL))?.isVerified,
      accounts: await harness().accountCount(),
    }).toEqual({
      isVerified: true,
      accounts: 1,
    });
  });

  it('refuses the link of a deleted account and leaves the account as it was', async () => {
    await harness().seedAccount({
      email: EMAIL,
      isVerified: false,
      isDeleted: true,
    });
    await seedLink();

    const refusal = await refusalOf(verify());
    const account = await harness().account(EMAIL);

    expect({
      refusal,
      signIns: services.signedIn.length,
      account: [account?.isDeleted, account?.isVerified],
    }).toEqual({ refusal: INVALID, signIns: 0, account: [true, false] });
  });

  it('L1 refuses a new magic-link account at a claimed address', async () => {
    const h = harness();
    await seedLink({ tokenHash: hashMagicLinkToken('held-token') });
    await holdAddress(h.ledger, h.runner, h.clock, EMAIL);
    expect(await refusalOf(verify('held-token'))).toEqual(INVALID);
    expect(await h.accountCount()).toBe(0);
    expect(services.signedIn).toEqual([]);
  });

  it('signs both in to one account when two links for a new address are spent at once', async () => {
    await seedLink({ tokenHash: hashMagicLinkToken('first-token') });
    await seedLink({ tokenHash: hashMagicLinkToken('second-token') });
    const gate = new RaceGate();
    const restore = holdBefore(harness().ledger, 'reserveForAccount', (call) =>
      call < 2 ? gate : undefined,
    );
    try {
      const both = [verify('first-token'), verify('second-token')];
      await gate.reached(2);
      gate.release();
      await Promise.all(both);
    } finally {
      gate.release();
      restore();
    }
    const account = await harness().account(EMAIL);

    expect({
      accounts: await harness().accountCount(),
      signedIn: services.signedIn,
    }).toEqual({ accounts: 1, signedIn: [account?.id, account?.id] });
  });

  it('leaves no account when creation is refused after claiming its link', async () => {
    await seedLink();
    policy.refused = true;

    expect({
      refusal: await refusalOf(verify()),
      account: await harness().account(EMAIL),
      accounts: await harness().accountCount(),
      signedIn: services.signedIn,
      claimedAt: (await harness().link(hashMagicLinkToken(TOKEN)))?.consumedAt,
      claims: await harness().claimCount(),
    }).toEqual({
      refusal: 'ACCOUNT_CREATION_REFUSED',
      account: null,
      accounts: 0,
      signedIn: [],
      claimedAt: TEST_NOW,
      claims: 0,
    });
  });
}
