import { Logger } from '@nestjs/common';
import { MongoClient, MongoTopologyClosedError } from 'mongodb';
import { createConnection, Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { Response } from 'express';
import type { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { PENDING_PURPOSE } from '../../../../constants/registration';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import type { ReservedCode } from '../../../../interfaces/pending-code.interface';
import {
  createModelMock,
  partialMock,
} from '../../../../../common/testing/test-doubles.harness-spec';
import { AuthMailService } from '../../../../services/mail/auth-mail.service';
import { HashService } from '../../../../../common/services/hash.service';
import { MailCounterService } from '../../../../services/mail/mail-counter.service';
import { mongoRegistrationService } from '../../../../../../test/utils/auth/mongo-activation';
import { SignInService } from '../../sign-in.service';
import { VerificationCodeService } from '../../../../services/codes/verification-code.service';

describe('RegistrationService unknown commit re-read', () => {
  it('logs a failed account re-read and answers with the unknown outcome code', async () => {
    const driver = new MongoClient('mongodb://127.0.0.1:27017');
    const session = driver.startSession();
    const connection = createConnection();
    const commitFailure = new MongoTopologyClosedError();
    const readFailure = new Error('account read unavailable');
    const reserved: ReservedCode = {
      id: new Types.ObjectId(),
      email: 'person@example.test',
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: 'hashed-code',
    };
    const query = { session: jest.fn().mockResolvedValue(null) };
    const model = createModelMock<Model<UserDocument>>({
      findOne: jest.fn().mockReturnValue(query),
      findById: jest.fn().mockRejectedValue(readFailure),
    });
    Object.assign(model.prototype, {
      save: jest.fn().mockResolvedValue(undefined),
    });
    const verification = partialMock<VerificationCodeService>({
      verifyCode: jest.fn().mockResolvedValue(reserved),
      consumeCode: jest.fn().mockResolvedValue(true),
    });
    const hash = partialMock<HashService>({
      hash: jest.fn().mockResolvedValue('password-hash'),
    });
    const mail = partialMock<AuthMailService>({});
    const mailCounter = partialMock<MailCounterService>({});
    const signIn = partialMock<SignInService>({});
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'commitTransaction').mockRejectedValue(commitFailure);
    jest.spyOn(session, 'endSession').mockResolvedValue(undefined);
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = mongoRegistrationService(
      model,
      connection,
      hash,
      mail,
      verification,
      mailCounter,
      signIn,
    );

    try {
      await expect(
        service.activate(
          {
            email: reserved.email,
            code: '123456',
            password: 'Password123!',
            name: 'Person',
          },
          partialMock<Response>({}),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        status: 503,
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('cause=name=MongoTopologyClosedError'),
      );
    } finally {
      log.mockRestore();
      await connection.close();
      await driver.close();
    }
  });
});
