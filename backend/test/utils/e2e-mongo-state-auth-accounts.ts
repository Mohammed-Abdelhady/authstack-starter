import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
// feature:passkeys:start
import {
  Passkey,
  PasskeyDocument,
} from '../../src/auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import {
  User,
  UserDocument,
} from '../../src/user/persistence/mongo/schemas/user.schema';
import type { E2eAccountState } from './e2e-state-auth';

/** Accounts on MongoDB, through the models the cases used to ask for. */
export function mongoAccountState(app: INestApplication): E2eAccountState {
  const users = app.get<Model<UserDocument>>(getModelToken(User.name));
  // feature:passkeys:start
  const passkeys = (): Model<PasskeyDocument> =>
    app.get<Model<PasskeyDocument>>(getModelToken(Passkey.name));
  // feature:passkeys:end

  return {
    countAccountsWithAddress: (email) => users.countDocuments({ email }),
    removePassword: async (email) => {
      await users.updateOne({ email }, { $unset: { password: 1 } });
    },
    linkProviderAccounts: async (email, links) => {
      await users.updateOne({ email }, { $set: { linkedAccounts: links } });
    },
    makeProviderCreated: async (email, provider, links) => {
      await users.updateOne(
        { email },
        { $set: { authProvider: provider, linkedAccounts: links } },
      );
    },
    // feature:passkeys:start
    storePasskey: async (email, passkey) => {
      const owner = await users.findOne({ email }).orFail().exec();
      const stored = await passkeys().create({ user: owner._id, ...passkey });
      return stored._id.toString();
    },
    countPasskeys: () => passkeys().countDocuments({}),
    removeEveryPasskey: async () => {
      await passkeys().deleteMany({});
    },
    // feature:passkeys:end
  };
}
