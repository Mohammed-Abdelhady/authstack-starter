import { Logger } from '@nestjs/common';
import { MongoClient, MongoTopologyClosedError } from 'mongodb';
import { createConnection, Model, Types } from 'mongoose';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { PENDING_PURPOSE } from '../../../../constants/registration';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { ReservedCode } from '../../../../interfaces/pending-code.interface';
import { partialMock } from '../../../../../common/testing/test-doubles.harness-spec';
import { mongoEmailChangeConfirmation } from '../../../../../../test/utils/auth/mongo-activation';
import { AccountSessions } from '../../../../../user/stores/account-sessions';
import { VerificationCodeService } from '../../../../services/codes/verification-code.service';

describe('EmailChangeConfirmationService', () => {
  it('logs a failed commit re-read and answers with the unknown outcome code', async () => {
    const driver = new MongoClient('mongodb://127.0.0.1:27017');
    const session = driver.startSession();
    const connection = createConnection();
    const commitFailure = new MongoTopologyClosedError();
    const readFailure = new Error('user read unavailable');
    const userId = new Types.ObjectId();
    const reserved: ReservedCode = {
      id: new Types.ObjectId(),
      email: 'person@example.test',
      purpose: PENDING_PURPOSE.EMAIL_CHANGE,
      hashedCode: 'hashed-code',
      userId,
      addressGeneration: 4,
    };
    const user = partialMock<UserDocument>({
      email: reserved.email,
      pendingEmail: reserved.email,
      addressGeneration: 4,
      isVerified: false,
      save: jest.fn().mockResolvedValue(undefined),
    });
    const query = { session: jest.fn().mockResolvedValue(user) };
    const model = partialMock<Model<UserDocument>>({
      findOne: jest.fn().mockReturnValue(query),
      findById: jest.fn().mockRejectedValue(readFailure),
    });
    const verification = partialMock<VerificationCodeService>({
      verifyCode: jest.fn().mockResolvedValue(reserved),
      consumeCode: jest.fn().mockResolvedValue(true),
    });
    jest.spyOn(connection, 'startSession').mockResolvedValue(session);
    jest.spyOn(session, 'commitTransaction').mockRejectedValue(commitFailure);
    jest.spyOn(session, 'endSession').mockResolvedValue(undefined);
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = mongoEmailChangeConfirmation(
      model,
      connection,
      verification,
      partialMock<AccountSessions>({ revokeAll: jest.fn() }),
    );

    try {
      await expect(
        service.confirm({ email: reserved.email, code: 'plain-code' }),
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
