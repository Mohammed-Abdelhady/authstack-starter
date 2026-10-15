import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createConnection } from 'mongoose';
import { AddressLedger } from '../../../../../common/persistence/address-ledger';
import { MongoAddressLedger } from '../../../../../common/persistence/mongo/mongo-address-ledger';
import {
  AddressClaim,
  AddressClaimSchema,
} from '../../../../../common/persistence/mongo/schemas/address-claim.schema';
import { MongoUnitOfWorkRunner } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import {
  User,
  UserSchema,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import {
  MailCounter,
  MailCounterSchema,
} from '../../../../persistence/mongo/schemas/mail-counter.schema';
import { MongoMagicLinkAccounts } from '../mongo-magic-link-accounts';
import { MongoMagicLinkStore } from '../mongo-magic-link.store';
import {
  PendingMagicLink,
  PendingMagicLinkSchema,
} from '../schemas/pending-magic-link.schema';
import { MagicLinkAccounts } from '../../../stores/magic-link-accounts';
import { MagicLinkStore } from '../../../stores/magic-link.store';
import { MagicLinkContractHarness } from '../../../contract/magic-link-contract.harness-spec';

/** `onCommand` hears the name of every command the driver sends. */
export async function bootMongoMagicLinkHarness(
  onCommand?: (commandName: string) => void,
): Promise<MagicLinkContractHarness> {
  const mongo = await startMemoryReplSet();
  const connection = await createConnection(mongo.uri('magic_link_contract'), {
    monitorCommands: onCommand !== undefined,
  }).asPromise();
  connection.getClient().on('commandStarted', (command) => {
    onCommand?.(command.commandName);
  });
  const claims = connection.model(AddressClaim.name, AddressClaimSchema);
  await claims.init();
  const links = connection.model(PendingMagicLink.name, PendingMagicLinkSchema);
  const users = connection.model(User.name, UserSchema);
  const counters = connection.model(MailCounter.name, MailCounterSchema);
  await links.init();
  await counters.init();
  await users.init();
  // Built the way the application builds them: each adapter over its model.
  const module = await Test.createTestingModule({
    providers: [
      { provide: AddressLedger, useClass: MongoAddressLedger },
      { provide: getModelToken(AddressClaim.name), useValue: claims },
      { provide: MagicLinkStore, useClass: MongoMagicLinkStore },
      { provide: MagicLinkAccounts, useClass: MongoMagicLinkAccounts },
      { provide: getModelToken(PendingMagicLink.name), useValue: links },
      { provide: getModelToken(User.name), useValue: users },
      { provide: getModelToken(MailCounter.name), useValue: counters },
    ],
  }).compile();

  return {
    clock: new FrozenClock(TEST_NOW),
    ledger: module.get(AddressLedger),
    links: module.get(MagicLinkStore),
    accounts: module.get(MagicLinkAccounts),
    runner: new MongoUnitOfWorkRunner(connection),

    seedLink: async (link) => {
      await links.create({ ...link, consumedAt: link.consumedAt ?? null });
    },
    link: async (tokenHash) => {
      const stored = await links.findOne({ tokenHash }).lean().exec();
      return stored
        ? {
            email: stored.email,
            tokenHash: stored.tokenHash,
            expiresAt: stored.expiresAt,
            consumedAt: stored.consumedAt,
            requestIp: stored.requestIp ?? null,
            userAgent: stored.userAgent ?? null,
            redirect: stored.redirect ?? null,
          }
        : null;
    },
    linkCount: () => links.countDocuments({}).exec(),

    seedAccount: async (account) => {
      const created = await users.create({
        email: account.email,
        name: 'Contract Tester',
        isVerified: account.isVerified,
        isDeleted: account.isDeleted,
      });
      return created._id.toString();
    },
    account: async (email) => {
      const stored = await users.findOne({ email }).lean().exec();
      return stored
        ? {
            id: stored._id.toString(),
            name: stored.name ?? null,
            isVerified: Boolean(stored.isVerified),
            isDeleted: Boolean(stored.isDeleted),
            authProvider: stored.authProvider ?? null,
          }
        : null;
    },
    accountCount: () => users.countDocuments({}).exec(),
    claimCount: () => claims.countDocuments({}).exec(),

    reset: async () => {
      await links.deleteMany({});
      await counters.deleteMany({});
      await claims.deleteMany({});
      await users.deleteMany({});
    },
    close: async () => {
      await connection.close();
      await mongo.stop();
    },
  };
}
