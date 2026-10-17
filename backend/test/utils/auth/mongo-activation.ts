import { mongoActivationPolicy } from './mongo-activation-policy';
import { ConfigService } from '@nestjs/config';
import { browserApplicationsForTest } from '../../../src/common/testing/browser-applications.harness-spec';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import { MongoAddressLedger } from '../../../src/common/persistence/mongo/mongo-address-ledger';
import {
  AddressClaim,
  AddressClaimDocument,
  AddressClaimSchema,
} from '../../../src/common/persistence/mongo/schemas/address-claim.schema';
import { FrozenClock, TEST_NOW } from '../frozen-clock';

import { AccountCreationPolicy } from '../../../src/auth/services/registration/account-creation-policy';
import { WEB_CLIENT_ID } from '../../../src/session/constants/client-ids';
import { AccountSessions } from '../../../src/user/stores/account-sessions';
import { ReservedCode } from '../../../src/auth/interfaces/pending-code.interface';
import {
  MongoActivationAccounts,
  MongoActivationSignIn,
} from '../../../src/auth/persistence/mongo/mongo-activation-accounts';
import { VerificationCodeService } from '../../../src/auth/services/codes/verification-code.service';
import { AuthMailService } from '../../../src/auth/services/mail/auth-mail.service';
import { MailCounterService } from '../../../src/auth/services/mail/mail-counter.service';
import { EmailChangeConfirmationService } from '../../../src/auth/services/registration/email-change-confirmation.service';
import { RegistrationService } from '../../../src/auth/services/registration/registration.service';
import { SignInService } from '../../../src/auth/persistence/mongo/sign-in.service';
import {
  confirmEmailChange as confirmInWork,
  createActivatedAccount as createInWork,
} from '../../../src/auth/utils/activation.util';
import { HashService } from '../../../src/common/services/hash.service';
import {
  MongoUnitOfWorkRunner,
  mongoUnitOfWork,
} from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import { UserDocument } from '../../../src/user/persistence/mongo/schemas/user.schema';
import { DEFAULT_LOCALE } from '../../../src/common/constants/locales';

function ledgerOn(users: Model<UserDocument>): AddressLedger {
  users.db.model(AddressClaim.name, AddressClaimSchema);
  return new MongoAddressLedger(
    users.db.model<AddressClaimDocument>(AddressClaim.name),
    users,
  );
}

/** The registration service on the MongoDB adapters over the given model. */
export function mongoRegistrationService(
  userModel: Model<UserDocument>,
  connection: Connection,
  hashService: HashService,
  authMailService: AuthMailService,
  verificationCodeService: VerificationCodeService,
  mailCounterService: MailCounterService,
  signInService: SignInService,
  policy: AccountCreationPolicy = mongoActivationPolicy(userModel.db),
): RegistrationService {
  const config = new ConfigService({});
  const browserApplications = browserApplicationsForTest(config);
  return new RegistrationService(
    new MongoActivationAccounts(userModel),
    new MongoUnitOfWorkRunner(connection),
    hashService,
    authMailService,
    verificationCodeService,
    mailCounterService,
    new MongoActivationSignIn(signInService),
    policy,
    ledgerOn(userModel),
    new FrozenClock(TEST_NOW),
    browserApplications,
  );
}

/** The confirmation service on the MongoDB adapters over the given model. */
export function mongoEmailChangeConfirmation(
  userModel: Model<UserDocument>,
  connection: Connection,
  verificationCodeService: VerificationCodeService,
  sessions: AccountSessions,
): EmailChangeConfirmationService {
  return new EmailChangeConfirmationService(
    new MongoActivationAccounts(userModel),
    new MongoUnitOfWorkRunner(connection),
    verificationCodeService,
    sessions,
    ledgerOn(userModel),
    new FrozenClock(TEST_NOW),
  );
}

/** The activation insert for a spec that owns a Mongoose transaction. */
export async function createActivatedAccount(
  reserved: ReservedCode,
  passwordHash: string,
  name: string,
  userModel: Model<UserDocument>,
  session: ClientSession,
  accountId: Types.ObjectId,
  policy: AccountCreationPolicy = mongoActivationPolicy(userModel.db),
  application: string = WEB_CLIENT_ID,
): Promise<{ _id: Types.ObjectId }> {
  const account = await createInWork(
    new MongoActivationAccounts(userModel),
    mongoUnitOfWork(session),
    reserved,
    { id: accountId.toString(), passwordHash, name, locale: DEFAULT_LOCALE },
    policy,
    application,
    ledgerOn(userModel),
    new FrozenClock(TEST_NOW).now(),
  );
  return { _id: new Types.ObjectId(account.id) };
}

/** The address confirmation for a spec that owns a Mongoose transaction. */
export function confirmEmailChange(
  reserved: ReservedCode,
  userModel: Model<UserDocument>,
  session: ClientSession,
): Promise<string | null> {
  return confirmInWork(
    new MongoActivationAccounts(userModel),
    mongoUnitOfWork(session),
    reserved,
    ledgerOn(userModel),
    new FrozenClock(TEST_NOW).now(),
  );
}
