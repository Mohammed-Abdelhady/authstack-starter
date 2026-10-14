import { Injectable, Provider } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Response } from 'express';
import { Model, Types } from 'mongoose';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { isMongoDuplicateKeyError } from '../../../common/persistence/mongo/mongo-error.util';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { AuthProvider } from '../../../user/enums/auth-provider.enum';
import { storedLocale } from '../../../common/constants/locales';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  ActivatedAccount,
  ACTIVATION_CONSTRAINT,
  ActivationAccounts,
  ActivationSignIn,
  ActivationSignInOutcome,
  AddressConfirmation,
  AddressOwner,
  MovedAccount,
  NewActivatedAccount,
} from '../../pending-codes/activation-accounts';
import { FIRST_FACTOR } from '../../services/sessions/first-factor'; // feature:totp
import { SignInService } from './sign-in.service';

class MongoActivatedAccount extends ActivatedAccount {
  constructor(
    readonly id: string,
    readonly document: UserDocument,
  ) {
    super();
  }
}

class MongoMovedAccount extends MovedAccount {
  constructor(readonly document: UserDocument) {
    super();
  }

  get email(): string {
    return this.document.email;
  }

  get pendingEmail(): string | undefined {
    return this.document.pendingEmail;
  }

  get addressGeneration(): number {
    return this.document.addressGeneration ?? 0;
  }
}

/** The document an activation stored, for the MongoDB adapter only. */
export function activatedDocumentOf(account: ActivatedAccount): UserDocument {
  if (!(account instanceof MongoActivatedAccount)) {
    throw new Error('This account was not stored on MongoDB');
  }
  return account.document;
}

@Injectable()
export class MongoActivationAccounts extends ActivationAccounts {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  newAccountId(): string {
    return new Types.ObjectId().toString();
  }

  async findAddressOwner(email: string): Promise<AddressOwner | null> {
    const user = await this.userModel.findOne({ email: { $eq: email } });
    return user
      ? {
          name: user.name,
          isDeleted: Boolean(user.isDeleted),
          locale: storedLocale(user.locale),
        }
      : null;
  }

  async isStored(accountId: string): Promise<boolean> {
    return Boolean(
      await this.userModel.findById(new Types.ObjectId(accountId)),
    );
  }

  async findAddressConfirmation(
    userId: string,
  ): Promise<AddressConfirmation | null> {
    const user = await this.userModel.findById(userId);
    if (user === null) return null;
    return {
      email: user.email,
      pendingEmail: user.pendingEmail,
      isVerified: user.isVerified === true,
      addressGeneration: user.addressGeneration ?? 0,
    };
  }

  async hasActiveAccount(
    unitOfWork: UnitOfWork,
    email: string,
  ): Promise<boolean> {
    const existing = await this.userModel
      .findOne({ email: { $eq: email }, isDeleted: { $ne: true } })
      .session(mongoSessionOf(unitOfWork));
    return Boolean(existing);
  }

  async insertActivated(
    unitOfWork: UnitOfWork,
    account: NewActivatedAccount,
  ): Promise<ActivatedAccount> {
    const user = new this.userModel({
      _id: new Types.ObjectId(account.id),
      email: account.email,
      password: account.passwordHash,
      name: account.name,
      isVerified: true,
      authProvider: AuthProvider.EMAIL,
      primaryProvider: AuthProvider.EMAIL,
      locale: account.locale,
    });
    try {
      await user.save({ session: mongoSessionOf(unitOfWork) });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new UniqueConflictError(ACTIVATION_CONSTRAINT.ADDRESS, error);
      }
      throw error;
    }
    return new MongoActivatedAccount(account.id, user);
  }

  async readMovedAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<MovedAccount | null> {
    const user = await this.userModel
      .findOne({ _id: userId, isDeleted: { $ne: true } })
      .session(mongoSessionOf(unitOfWork));
    return user === null ? null : new MongoMovedAccount(user);
  }

  async confirmAddress(
    unitOfWork: UnitOfWork,
    account: MovedAccount,
    email: string,
  ): Promise<void> {
    if (!(account instanceof MongoMovedAccount)) {
      throw new Error('This account was not read from MongoDB');
    }
    account.document.email = email;
    account.document.pendingEmail = undefined;
    account.document.isVerified = true;
    try {
      await account.document.save({ session: mongoSessionOf(unitOfWork) });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new UniqueConflictError(ACTIVATION_CONSTRAINT.ADDRESS, error);
      }
      throw error;
    }
  }
}

/**
 * Hands the account to the sign-in service, which still takes a document. It
 * goes away when sign-in takes an account id.
 */
@Injectable()
export class MongoActivationSignIn extends ActivationSignIn {
  constructor(private readonly signInService: SignInService) {
    super();
  }

  complete(
    account: ActivatedAccount,
    response: Response,
  ): Promise<ActivationSignInOutcome> {
    return this.signInService.completeSignIn(
      activatedDocumentOf(account),
      response,
      FIRST_FACTOR.EMAIL_CODE, // feature:totp
    );
  }
}

/** The activation stores on MongoDB. */
export const MONGO_ACTIVATION_STORES: Provider[] = [
  { provide: ActivationAccounts, useClass: MongoActivationAccounts },
  { provide: ActivationSignIn, useClass: MongoActivationSignIn },
];
