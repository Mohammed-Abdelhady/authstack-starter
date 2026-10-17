import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import { mapMongoError } from '../../../../session/persistence/mongo/mongo-persistence-errors';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import { singleStatement } from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { FIRST_FACTOR } from '../../../services/sessions/first-factor';
import type { BrowserEvidence } from '../../../../session/types/browser-evidence';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import {
  PasskeyAccount,
  PasskeyAccountPassword,
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

  async findPassword(userId: string): Promise<PasskeyAccountPassword | null> {
    const user = await accountStatement(() =>
      this.userModel.findById(userId).select('+password'),
    );
    return user ? { passwordHash: user.password || undefined } : null;
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

  /**
   * Fences the account first, the way the sign-in method rule does: a write
   * to the account inside the work, so a deactivation that writes it before
   * the work ends conflicts and is refused or rerun, never committed under
   * the passkey. The standing is read after the fence.
   */
  async readStanding(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<{ isDeleted: boolean } | null> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new MalformedIdError();
    }
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
    const user = await this.userModel
      .findById(userId)
      .select('isDeleted')
      .session(session);
    return user ? { isDeleted: Boolean(user.isDeleted) } : null;
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
    evidence: BrowserEvidence,
  ): Promise<AuthenticatedUserSummary> {
    return this.signInService.issueSession(
      documentOf(account),
      response,
      evidence,
    );
  }

  completeSignIn(
    account: PasskeyAccount,
    response: Response,
  ): Promise<PasskeySignInOutcome> {
    return this.signInService.completeSignIn(
      documentOf(account),
      response,
      FIRST_FACTOR.PASSKEY,
    );
  }
}
