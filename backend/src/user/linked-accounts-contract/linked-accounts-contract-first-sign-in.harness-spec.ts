import { rejectionOf } from '../../../test/utils/session/issuance-contract/issuance-contract-support';
import { storedAccount } from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import {
  LinkedFixture,
  LinkedHarnessSource,
  OWNER_EMAIL,
} from './linked-accounts-contract.harness-spec';

const IDENTITY_RULE = 'user.linked_account';
const ADDRESS_RULE = 'user.email';
const NEW_ADDRESS = 'newcomer@example.test';
const GOOGLE_OWNER = { provider: 'google', providerId: 'google-owner' };

function conflictOf(error: unknown): string {
  return error instanceof UniqueConflictError
    ? error.constraint
    : `not a unique conflict: ${String(error)}`;
}

/** A first sign-in through a provider: the account it finds, links or stores. */
export function firstProviderSignInCases(
  harness: LinkedHarnessSource,
  fixture: () => LinkedFixture,
): void {
  it('finds the account a provider identity is linked to, and only that identity', async () => {
    const { ownerId } = fixture();
    const { providerSignIn } = harness();
    const owner = await providerSignIn.findByAddress(OWNER_EMAIL);
    if (!owner) throw new Error('the owner was not found');
    await providerSignIn.linkFirstSignIn(owner, GOOGLE_OWNER);

    expect({
      linked: (await providerSignIn.findByIdentity(GOOGLE_OWNER))?.id,
      otherProvider: await providerSignIn.findByIdentity({
        provider: 'github',
        providerId: 'google-owner',
      }),
      otherId: await providerSignIn.findByIdentity({
        provider: 'google',
        providerId: 'google-other',
      }),
    }).toEqual({ linked: ownerId, otherProvider: null, otherId: null });
  });

  it('answers a deactivated account as deactivated, by identity and by address', async () => {
    const { ownerId } = fixture();
    const { providerSignIn } = harness();
    const owner = await providerSignIn.findByAddress(OWNER_EMAIL);
    if (!owner) throw new Error('the owner was not found');
    await providerSignIn.linkFirstSignIn(owner, GOOGLE_OWNER);
    await harness().alterAccount(ownerId, { deleted: true });

    const byIdentity = await providerSignIn.findByIdentity(GOOGLE_OWNER);
    const byAddress = await providerSignIn.findByAddress(OWNER_EMAIL);

    expect({
      byIdentity: { id: byIdentity?.id, isDeleted: byIdentity?.isDeleted },
      byAddress: { id: byAddress?.id, isDeleted: byAddress?.isDeleted },
      unknown: await providerSignIn.findByAddress('nobody@example.test'),
    }).toEqual({
      byIdentity: { id: ownerId, isDeleted: true },
      byAddress: { id: ownerId, isDeleted: true },
      unknown: null,
    });
  });

  it('links a first sign-in, verifies the address and makes the provider primary', async () => {
    const { ownerId } = fixture();
    const { providerSignIn } = harness();
    await harness().alterAccount(ownerId, { verified: false });
    const owner = await providerSignIn.findByAddress(OWNER_EMAIL);
    if (!owner) throw new Error('the owner was not found');

    const linked = await providerSignIn.linkFirstSignIn(owner, GOOGLE_OWNER);

    expect({
      id: linked.id,
      isVerified: linked.isVerified,
      primaryProvider: linked.primaryProvider,
      linkedProviders: linked.linkedProviders,
      storedLinks: await harness().storedLinks(ownerId),
      stored: {
        isVerified: (await storedAccount(harness(), ownerId)).isVerified,
        primaryProvider: (await storedAccount(harness(), ownerId))
          .primaryProvider,
      },
    }).toEqual({
      id: ownerId,
      isVerified: true,
      primaryProvider: 'google',
      linkedProviders: ['email', 'google'],
      storedLinks: [GOOGLE_OWNER],
      stored: { isVerified: true, primaryProvider: 'google' },
    });
  });

  it('keeps the primary provider an account already has', async () => {
    const { ownerId } = fixture();
    const { providerSignIn } = harness();
    const owner = await providerSignIn.findByAddress(OWNER_EMAIL);
    if (!owner) throw new Error('the owner was not found');
    const first = await providerSignIn.linkFirstSignIn(owner, GOOGLE_OWNER);

    const second = await providerSignIn.linkFirstSignIn(first, {
      provider: 'github',
      providerId: 'github-owner',
    });

    expect({
      primaryProvider: second.primaryProvider,
      stored: (await storedAccount(harness(), ownerId)).primaryProvider,
      links: (await harness().storedLinks(ownerId)).map(
        ({ provider }) => provider,
      ),
    }).toEqual({
      primaryProvider: 'google',
      stored: 'google',
      links: ['google', 'github'],
    });
  });

  it('refuses an identity another account holds and leaves the account as it was', async () => {
    const { ownerId, otherId } = fixture();
    const { providerSignIn } = harness();
    const owner = await providerSignIn.findByAddress(OWNER_EMAIL);
    const other = await providerSignIn.findByAddress('other@example.test');
    if (!owner || !other) throw new Error('an account was not found');
    await providerSignIn.linkFirstSignIn(owner, GOOGLE_OWNER);
    await harness().alterAccount(otherId, { verified: false });
    const fresh = await providerSignIn.findByAddress('other@example.test');
    if (!fresh) throw new Error('the other account was not found');

    const refused = await rejectionOf(
      providerSignIn.linkFirstSignIn(fresh, GOOGLE_OWNER),
    );

    const stored = await storedAccount(harness(), otherId);
    expect({
      rule: conflictOf(refused),
      links: await harness().storedLinks(otherId),
      isVerified: stored.isVerified,
      primaryProvider: stored.primaryProvider,
      ownerLinks: await harness().storedLinks(ownerId),
    }).toEqual({
      rule: IDENTITY_RULE,
      links: [],
      isVerified: false,
      primaryProvider: null,
      ownerLinks: [GOOGLE_OWNER],
    });
  });

  it('stores a verified account for a new provider identity', async () => {
    const { providerSignIn } = harness();

    const created = await providerSignIn.createFromProvider({
      provider: 'google',
      providerId: 'google-new',
      email: NEW_ADDRESS,
      name: 'New Comer',
      avatarUrl: 'https://img.example.test/new.png',
      role: 'user',
      locale: 'en',
    });

    const stored = await storedAccount(harness(), created.id);
    expect({
      returned: {
        email: created.email,
        name: created.name,
        avatarUrl: created.avatarUrl,
        role: created.role,
        authProvider: created.authProvider,
        primaryProvider: created.primaryProvider,
        isVerified: created.isVerified,
        isDeleted: created.isDeleted,
        linkedProviders: created.linkedProviders,
      },
      stored: {
        email: stored.email,
        name: stored.name,
        role: stored.role,
        passwordHash: stored.passwordHash,
        isVerified: stored.isVerified,
        isDeleted: stored.isDeleted,
        authProvider: stored.authProvider,
        primaryProvider: stored.primaryProvider,
      },
      avatarUrl: (await harness().syncFacts(created.id))?.avatarUrl,
      links: await harness().storedLinks(created.id),
      found: (await harness().accountIdByEmail(NEW_ADDRESS)) === created.id,
    }).toEqual({
      returned: {
        email: NEW_ADDRESS,
        name: 'New Comer',
        avatarUrl: 'https://img.example.test/new.png',
        role: 'user',
        authProvider: 'google',
        primaryProvider: 'google',
        isVerified: true,
        isDeleted: false,
        linkedProviders: ['google'],
      },
      stored: {
        email: NEW_ADDRESS,
        name: 'New Comer',
        role: 'user',
        passwordHash: null,
        isVerified: true,
        isDeleted: false,
        authProvider: 'google',
        primaryProvider: 'google',
      },
      avatarUrl: 'https://img.example.test/new.png',
      links: [{ provider: 'google', providerId: 'google-new' }],
      found: true,
    });
  });

  it('finds and stores an address whatever its case and the space around it', async () => {
    const { ownerId } = fixture();
    const { providerSignIn } = harness();

    const created = await providerSignIn.createFromProvider({
      provider: 'google',
      providerId: 'google-mixed',
      email: '  Mixed@Example.TEST ',
      name: '  Mixed Case  ',
      role: 'user',
      locale: 'en',
    });

    expect({
      owner: (await providerSignIn.findByAddress('  OWNER@example.TEST '))?.id,
      email: created.email,
      name: created.name,
      stored:
        (await harness().accountIdByEmail('mixed@example.test')) === created.id,
    }).toEqual({
      owner: ownerId,
      email: 'mixed@example.test',
      name: 'Mixed Case',
      stored: true,
    });
  });

  it('refuses a new account for a taken address and stores no link', async () => {
    const { ownerId } = fixture();
    const { providerSignIn } = harness();

    const refused = await rejectionOf(
      providerSignIn.createFromProvider({
        provider: 'google',
        providerId: 'google-clash',
        email: OWNER_EMAIL,
        name: 'Clash',
        role: 'user',
        locale: 'en',
      }),
    );

    expect({
      rule: conflictOf(refused),
      identity: await providerSignIn.findByIdentity({
        provider: 'google',
        providerId: 'google-clash',
      }),
      ownerLinks: await harness().storedLinks(ownerId),
    }).toEqual({ rule: ADDRESS_RULE, identity: null, ownerLinks: [] });
  });

  it('refuses a new account for a taken identity and stores no account', async () => {
    const { providerSignIn } = harness();
    const owner = await providerSignIn.findByAddress(OWNER_EMAIL);
    if (!owner) throw new Error('the owner was not found');
    await providerSignIn.linkFirstSignIn(owner, GOOGLE_OWNER);

    const refused = await rejectionOf(
      providerSignIn.createFromProvider({
        ...GOOGLE_OWNER,
        email: NEW_ADDRESS,
        name: 'New Comer',
        role: 'user',
        locale: 'en',
      }),
    );

    expect({
      rule: conflictOf(refused),
      stored: await harness().accountIdByEmail(NEW_ADDRESS),
    }).toEqual({ rule: IDENTITY_RULE, stored: null });
  });
}
