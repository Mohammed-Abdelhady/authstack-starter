import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import { mapMongoError } from '../../../../session/persistence/mongo/mongo-persistence-errors';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import { singleStatement } from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { FIRST_FACTOR } from '../../../services/sessions/first-factor'; // feature:totp
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import {
  PasskeyAccount,
  PasskeyAccounts,
  PasskeySignIn,
  PasskeySignInOutcome,
  StoredSignInMethods,
} from '../../stores/passkey-accounts';

// The sign-in service still takes the document the account was read from.
const DOCUMENTS = new WeakMap<PasskeyAccount, UserDocument>();

function documentOf(account: PasskeyAccount): UserDocument {
  const user = DOCUMENTS.get(account);
  if (!user) {
    throw new Error('This account was not read from MongoDB');
  }
  return user;
}

async function accountStatement<Result>(
  statement: () => Promise<Result>,
): Promise<Result> {
  try {
    return await singleStatement(statement);
  } catch (error) {
    const mapped = mapMongoError(error);
    throw mapped instanceof MalformedIdError ? mapped : error;
  }
}

@Injectable()
export class MongoPasskeyAccounts extends PasskeyAccounts {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  async findAccount(userId: string): Promise<PasskeyAccount | null> {
    const user = await accountStatement(() => this.userModel.findById(userId));
    if (!user) return null;
    const account: PasskeyAccount = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      isDeleted: Boolean(user.isDeleted),
    };
    DOCUMENTS.set(account, user);
    return account;
  }

  async findSignInMethods(userId: string): Promise<StoredSignInMethods | null> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new MalformedIdError();
    }
    const user = await accountStatement(() =>
      this.userModel.findById(userId).select('+password'),
    );
    if (!user) return null;
    return {
      hasPassword: Boolean(user.password),
      hasLinkedAccount: (user.linkedAccounts ?? []).length > 0,
    };
  }
}

/**
 * Hands the account to the sign-in service, which still takes a document. It
 * goes away when sign-in takes an account id.
 */
@Injectable()
export class MongoPasskeySignIn extends PasskeySignIn {
  constructor(private readonly signInService: SignInService) {
    super();
  }

  issueSession(
    account: PasskeyAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    return this.signInService.issueSession(documentOf(account), response);
  }

  completeSignIn(
    account: PasskeyAccount,
    response: Response,
  ): Promise<PasskeySignInOutcome> {
    return this.signInService.completeSignIn(
      documentOf(account),
      response,
      FIRST_FACTOR.PASSKEY, // feature:totp
    );
  }
}
