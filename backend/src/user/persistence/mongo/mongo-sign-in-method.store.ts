import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
// feature:passkeys:start
import {
  Passkey,
  PasskeyDocument,
} from '../../../auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import { EMAIL_PROVIDER } from '../../../common/constants/oauth-providers';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { User, UserDocument } from './schemas/user.schema';
import {
  HeldSignInMethods,
  SignInMethodStore,
} from '../../stores/sign-in-method.store';

/**
 * The fence is a write to the account: it conflicts with any other open
 * transaction that wrote the account, and MongoDB refuses the later writer at
 * once. It moves a counter of its own, because the document version would
 * fail a later save of a document read before, and the update time is shown.
 */
@Injectable()
export class MongoSignInMethodStore extends SignInMethodStore {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    // feature:passkeys:start
    @InjectModel(Passkey.name)
    private readonly passkeyModel: Model<PasskeyDocument>,
    // feature:passkeys:end
  ) {
    super();
  }

  async holdForAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<HeldSignInMethods | null> {
    const session = mongoSessionOf(unitOfWork);
    const fenced = await this.userModel
      .updateOne(
        { _id: userId },
        { $inc: { signInFence: 1 } },
        { session, timestamps: false },
      )
      .exec();
    if (fenced.matchedCount !== 1) {
      return null;
    }
    return this.read(userId, session);
  }

  readForAccount(userId: string): Promise<HeldSignInMethods | null> {
    return this.read(userId, null);
  }

  private async read(
    userId: string,
    session: ClientSession | null,
  ): Promise<HeldSignInMethods | null> {
    const user = await this.userModel
      .findById(userId)
      .select('+password')
      .session(session)
      .exec();
    if (!user) {
      return null;
    }
    // feature:passkeys:start
    const passkeys = await this.passkeyModel
      .countDocuments({ user: user._id })
      .session(session)
      .exec();
    // feature:passkeys:end

    return {
      emailSignIn: user.authProvider === EMAIL_PROVIDER,
      hasPassword: Boolean(user.password),
      linkedProviders: (user.linkedAccounts ?? []).map(
        (linked) => linked.provider,
      ),
      passkeys, // feature:passkeys
    };
  }
}
