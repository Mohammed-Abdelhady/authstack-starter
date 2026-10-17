import { assertMongoAccountAudience } from '../../../../user/persistence/mongo/mongo-account-audience';
import { UserRole } from '../../../../user/enums/user-role.enum';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Response } from 'express';
import { Model } from 'mongoose';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import { storedLocale } from '../../../../common/constants/locales';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { UniqueConflictError } from '../../../../common/persistence/persistence-errors';
import { isMongoDuplicateKeyError } from '../../../../common/persistence/mongo/mongo-error.util';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { singleStatement } from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { ACCOUNT_CREATION_METHOD } from '../../../constants/account-creation';
import { FIRST_FACTOR } from '../../../services/sessions/first-factor';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import {
  LinkRecipient,
  MAGIC_LINK_ACCOUNT_CONSTRAINT,
  MagicLinkAccount,
  MagicLinkAccounts,
  MagicLinkSignIn,
  MagicLinkSignInOutcome,
  NewPasswordlessAccount,
} from '../../stores/magic-link-accounts';

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

  async findByEmailIn(
    unitOfWork: UnitOfWork,
    email: string,
  ): Promise<MagicLinkAccount | null> {
    const user = await this.userModel
      .findOne({ email: { $eq: email } })
      .session(mongoSessionOf(unitOfWork));
    return user ? new MongoMagicLinkAccount(user) : null;
  }

  async findLinkRecipient(email: string): Promise<LinkRecipient | null> {
    const user = await singleStatement(() =>
      this.userModel.findOne(
        { email: { $eq: email } },
        { isDeleted: 1, locale: 1 },
      ),
    );
    return user
      ? {
          isDeleted: user.isDeleted === true,
          locale: storedLocale(user.locale),
        }
      : null;
  }

  async markVerified(account: MagicLinkAccount): Promise<void> {
    const user = documentOf(account);
    user.isVerified = true;
    await singleStatement(() => user.save());
  }

  async markVerifiedIn(
    unitOfWork: UnitOfWork,
    account: MagicLinkAccount,
  ): Promise<boolean> {
    const updated = await this.userModel.updateOne(
      { _id: documentOf(account)._id, isDeleted: { $ne: true } },
      { $set: { isVerified: true } },
      { session: mongoSessionOf(unitOfWork) },
    );
    return updated.matchedCount > 0;
  }

  async createPasswordlessIn(
    unitOfWork: UnitOfWork,
    account: NewPasswordlessAccount,
  ): Promise<MagicLinkAccount> {
    await assertMongoAccountAudience(
      this.userModel.db,
      unitOfWork,
      UserRole.USER,
      account.audience,
    );
    try {
      const user = await this.userModel.create(
        [
          {
            email: account.email,
            name: account.name,
            isVerified: true,
            authProvider: AuthProvider.EMAIL,
            primaryProvider: AuthProvider.EMAIL,
            locale: account.locale,
            audience: account.audience,
          },
        ],
        { session: mongoSessionOf(unitOfWork) },
      );
      const created = user[0];
      if (!created)
        throw new Error('Passwordless account insert returned none');
      return new MongoMagicLinkAccount(created);
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new UniqueConflictError(
          MAGIC_LINK_ACCOUNT_CONSTRAINT.ADDRESS,
          error,
        );
      }
      throw error;
    }
  }
}

@Injectable()
export class MongoMagicLinkSignIn extends MagicLinkSignIn {
  constructor(private readonly signInService: SignInService) {
    super();
  }

  assertAdmission(
    account: MagicLinkAccount,
    response: Response,
  ): Promise<void> {
    return this.signInService.assertAdmission(account.id, response);
  }

  recordCreationRefusal(clientId: string): Promise<void> {
    return this.signInService.recordCreationRefusal(
      clientId,
      ACCOUNT_CREATION_METHOD.MAGIC_LINK,
    );
  }

  complete(
    account: MagicLinkAccount,
    response: Response,
  ): Promise<MagicLinkSignInOutcome> {
    return this.signInService.completeSignIn(
      documentOf(account),
      response,
      FIRST_FACTOR.MAGIC_LINK,
    );
  }
}
