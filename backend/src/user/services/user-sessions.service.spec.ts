import { Test, TestingModule } from '@nestjs/testing';
import { IdFormat } from '../../common/persistence/id-format';
import { MongoIdFormat } from '../../common/persistence/mongo/mongo-id-format';
import { UserSessionsService } from './user-sessions.service';
import { Sessions } from '../../auth/services/sessions/sessions';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';

describe('UserSessionsService', () => {
  let service: UserSessionsService;

  const mockUserId = '507f1f77bcf86cd799439011';
  const mockSessionId = '507f1f77bcf86cd799439012';
  const otherSessionId = '507f1f77bcf86cd799439013';

  const mockSession = {
    id: mockSessionId,
    userId: mockUserId,
    userAgent: 'Mozilla/5.0',
    ip: '127.0.0.1',
    deviceName: 'Chrome',
    isValid: true,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    credentialPurpose: 'browser_session',
  };

  const mockSessionService = {
    getUserSessions: jest.fn().mockResolvedValue([mockSession]),
    invalidateAllSessionsExceptSession: jest.fn().mockResolvedValue(1),
    invalidateSessionById: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSessionsService,
        { provide: Sessions, useValue: mockSessionService },
        { provide: IdFormat, useClass: MongoIdFormat },
      ],
    }).compile();

    service = module.get<UserSessionsService>(UserSessionsService);

    jest.clearAllMocks();
    mockSessionService.getUserSessions.mockResolvedValue([mockSession]);
    mockSessionService.invalidateSessionById.mockResolvedValue(true);
  });

  describe('getSessions', () => {
    it('should return all active sessions', async () => {
      const result = await service.getSessions(mockUserId, mockSessionId);

      expect(result.success).toBe(true);
      expect(result.data?.sessions).toHaveLength(1);
      expect(result.data?.sessions[0].isCurrent).toBe(true);
      expect(result.data?.sessions[0].credentialPurpose).toBe(
        'browser_session',
      );
    });

    it('should mark no session current for a caller without a session', async () => {
      const result = await service.getSessions(mockUserId, null);

      expect(result.success).toBe(true);
      expect(result.data?.sessions).toHaveLength(1);
      expect(result.data?.sessions[0].isCurrent).toBe(false);
    });

    it('should reject a malformed user id', async () => {
      await expect(
        service.getSessions('not-an-id', mockSessionId),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_INPUT,
      });
    });
  });

  describe('revokeSession', () => {
    it('should revoke a session', async () => {
      const result = await service.revokeSession(
        mockUserId,
        otherSessionId,
        mockSessionId,
      );

      expect(result.success).toBe(true);
      expect(mockSessionService.invalidateSessionById).toHaveBeenCalled();
    });

    it('should throw error when revoking current session', async () => {
      await expect(
        service.revokeSession(mockUserId, mockSessionId, mockSessionId),
      ).rejects.toMatchObject({
        code: ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
      });
    });

    it.each([
      ['upper case', '507F1F77BCF86CD799439012'],
      ['mixed case', '507f1F77bcf86Cd799439012'],
    ])(
      'should refuse the current session named in %s, and revoke nothing',
      async (_form, sessionId) => {
        await expect(
          service.revokeSession(mockUserId, sessionId, mockSessionId),
        ).rejects.toMatchObject({
          code: ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
        });
        expect(mockSessionService.invalidateSessionById).not.toHaveBeenCalled();
      },
    );

    it('should throw error when session not found', async () => {
      mockSessionService.invalidateSessionById.mockResolvedValue(false);

      await expect(
        service.revokeSession(mockUserId, otherSessionId, mockSessionId),
      ).rejects.toMatchObject({ code: ErrorCode.SESSION_NOT_FOUND });
    });

    it('should reject a malformed session id', async () => {
      await expect(
        service.revokeSession(mockUserId, 'not-an-id', mockSessionId),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('should revoke all other sessions', async () => {
      mockSessionService.invalidateAllSessionsExceptSession.mockResolvedValue(
        3,
      );

      const result = await service.revokeAllOtherSessions(
        mockUserId,
        mockSessionId,
      );

      expect(result.success).toBe(true);
      expect(result.data?.revokedCount).toBe(3);
      expect(
        mockSessionService.invalidateAllSessionsExceptSession,
      ).toHaveBeenCalledWith(expect.anything(), mockSessionId);
    });

    it('should refuse without a current session', async () => {
      await expect(
        service.revokeAllOtherSessions(mockUserId, null),
      ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
    });
  });

  describe('revokeSession on UUID ids', () => {
    const userId = '018f4e2a-7b3c-7d10-9a5e-2c4b6d8e0f1a';
    const currentId = '018f4e2a-7b3c-7d10-9a5e-2c4b6d8e0fab';

    it.each([
      ['upper case', '018F4E2A-7B3C-7D10-9A5E-2C4B6D8E0FAB'],
      ['mixed case', '018f4E2a-7b3C-7d10-9A5e-2c4b6d8e0FaB'],
    ])(
      'should refuse the current session named in %s, and revoke nothing',
      async (_form, sessionId) => {
        const onUuids = new UserSessionsService(
          partialMock<Sessions>(mockSessionService),
          partialMock<IdFormat>({ isId: () => true }),
        );

        await expect(
          onUuids.revokeSession(userId, sessionId, currentId),
        ).rejects.toMatchObject({
          code: ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
        });
        expect(mockSessionService.invalidateSessionById).not.toHaveBeenCalled();
      },
    );
  });
});
