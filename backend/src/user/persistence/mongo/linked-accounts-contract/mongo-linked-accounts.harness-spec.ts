import { Types } from 'mongoose';
// feature:passkeys:start
import {
  Passkey,
  PasskeyDocument,
} from '../../../../auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import { bootMongoAccountsHarness } from '../../../../../test/utils/user/accounts-contract/mongo-accounts-harness';
import { MongoProviderSignInStore } from '../../../../auth/oauth/persistence/mongo/mongo-provider-sign-in.store';
import { MongoLinkedAccountStore } from '../mongo-linked-account.store';
import { MongoSignInMethodStore } from '../mongo-sign-in-method.store';
import { LinkedAccountsContractHarness } from '../../../linked-accounts-contract/linked-accounts-contract.harness-spec';

export async function bootMongoLinkedAccountsHarness(): Promise<LinkedAccountsContractHarness> {
  const accounts = await bootMongoAccountsHarness();
  const { users } = accounts.booted;
  // feature:passkeys:start
  const passkeys = accounts.booted.connection.model<PasskeyDocument>(
    Passkey.name,
  );
  // feature:passkeys:end

  return Object.assign(accounts, {
    links: new MongoLinkedAccountStore(users),
    providerSignIn: new MongoProviderSignInStore(users),
    signInMethods: new MongoSignInMethodStore(
      users,
      passkeys, // feature:passkeys
    ),
    storedLinks: async (userId: string) => {
      const user = await users.findById(userId).lean().exec();
      return (user?.linkedAccounts ?? []).map((linked) => ({
        provider: linked.provider,
        providerId: linked.providerId,
      }));
    },
    syncFacts: async (userId: string) => {
      const user = await users.findById(userId).lean().exec();
      if (!user) return null;
      return {
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
        primaryProvider: user.primaryProvider ?? null,
        lastSyncedProvider: user.lastSyncedProvider ?? null,
        profileSyncedAt: user.profileSyncedAt ?? null,
      };
    },
    markSynced: async (userId: string, at: Date | null) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        at
          ? { $set: { profileSyncedAt: at } }
          : { $unset: { profileSyncedAt: 1 } },
      );
    },
    setAuthProvider: async (userId: string, provider: string) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { authProvider: provider } },
      );
    },
  });
}
