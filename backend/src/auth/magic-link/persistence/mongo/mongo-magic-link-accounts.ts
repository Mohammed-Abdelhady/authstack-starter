import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Response } from 'express';
import { Model } from 'mongoose';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import {
  insertOrConflict,
  singleStatement,
} from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { FIRST_FACTOR } from '../../../services/sessions/first-factor'; // feature:totp
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import {
  MAGIC_LINK_ACCOUNT_CONSTRAINT,
  MagicLinkAccount,
  MagicLinkAccounts,
  MagicLinkSignIn,
  MagicLinkSignInOutcome,
  NewPasswordlessAccount,
} from '../../stores/magic-link-accounts';

const USER_INDEX_CONSTRAINTS = {
  email_1: MAGIC_LINK_ACCOUNT_CONSTRAINT.ADDRESS,
} as const;

class MongoMagicLinkAccount extends MagicLinkAccount {
  constructor(readonly document: UserDocument) {
    super();
  }

  get id(): string {
    return this.document._id.toString();
  }

  get isDeleted(): boolean {
    return Boolean(this.document.isDeleted);
  }

  get isVerified(): boolean {
    return Boolean(this.document.isVerified);
  }
}

function documentOf(account: MagicLinkAccount): UserDocument {
  if (!(account instanceof MongoMagicLinkAccount)) {
    throw new Error('This account was not read from MongoDB');
  }
  return account.document;
}

@Injectable()
export class MongoMagicLinkAccounts extends MagicLinkAccounts {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  async findByEmail(email: string): Promise<MagicLinkAccount | null> {
    const user = await singleStatement(() =>
      this.userModel.findOne({ email: { $eq: email } }),
    );
    return user ? new MongoMagicLinkAccount(user) : null;
  }

  async markVerified(account: MagicLinkAccount): Promise<void> {
    const user = documentOf(account);
    user.isVerified = true;
    await singleStatement(() => user.save());
  }

  async createPasswordless(
    account: NewPasswordlessAccount,
  ): Promise<MagicLinkAccount> {
    const user = await insertOrConflict(USER_INDEX_CONSTRAINTS, () =>
      this.userModel.create({
        email: account.email,
        name: account.name,
        isVerified: true,
        authProvider: AuthProvider.EMAIL,
        primaryProvider: AuthProvider.EMAIL,
      }),
    );
    return new MongoMagicLinkAccount(user);
  }
}

@Injectable()
export class MongoMagicLinkSignIn extends MagicLinkSignIn {
  constructor(private readonly signInService: SignInService) {
    super();
  }

  complete(
    account: MagicLinkAccount,
    response: Response,
  ): Promise<MagicLinkSignInOutcome> {
    return this.signInService.completeSignIn(
      documentOf(account),
      response,
      FIRST_FACTOR.MAGIC_LINK, // feature:totp
    );
  }
}
