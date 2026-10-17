import { IdFormat } from '../../common/persistence/id-format';
import { MongoIdFormat } from '../../common/persistence/mongo/mongo-id-format';
import { PostgresIdFormat } from '../../common/persistence/postgres/postgres-id-format'; // feature:postgres
import { UserSessionsService } from './user-sessions.service';
import { Sessions } from '../../auth/services/sessions/sessions';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';

interface SessionsDouble {
  getUserSessions: jest.Mock;
  invalidateAllSessionsExceptSession: jest.Mock;
  invalidateSessionById: jest.Mock;
}

const SEEN_AT = new Date('2026-01-02T03:04:05.000Z');

function sessionOf(id: string, userId: string) {
  return {
    id,
    userId,
    userAgent: 'Mozilla/5.0',
    ip: '127.0.0.1',
    deviceName: 'Chrome',
    isValid: true,
    lastUsedAt: SEEN_AT,
    createdAt: SEEN_AT,
    credentialPurpose: 'browser_session',
  };
}

/** A fresh double per test, so no answer or call survives into the next. */
function createSessions(listed: ReturnType<typeof sessionOf>): SessionsDouble {
  return {
    getUserSessions: jest.fn().mockResolvedValue([listed]),
    invalidateAllSessionsExceptSession: jest.fn().mockResolvedValue(3),
    invalidateSessionById: jest.fn().mockResolvedValue(true),
  };
}

function serviceOn(ids: IdFormat, sessions: SessionsDouble) {
  return new UserSessionsService(partialMock<Sessions>(sessions), ids);
}

describe('UserSessionsService', () => {
  const mockUserId = '507f1f77bcf86cd799439011';
  const mockSessionId = '507f1f77bcf86cd799439012';
  const otherSessionId = '507f1f77bcf86cd799439013';

  let sessions: SessionsDouble;
  let service: UserSessionsService;

  beforeEach(() => {
    sessions = createSessions(sessionOf(mockSessionId, mockUserId));
    service = serviceOn(new MongoIdFormat(), sessions);
  });

  describe('getSessions', () => {
    it('should reject a malformed user id', async () => {
      await expect(
        service.getSessions('not-an-id', mockSessionId),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_INPUT,
      });
      expect(sessions.getUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('should revoke the named session of the calling account', async () => {
      const result = await service.revokeSession(
        mockUserId,
        otherSessionId,
        mockSessionId,
      );

      expect(result.success).toBe(true);
      expect(sessions.invalidateSessionById.mock.calls).toEqual([
        [otherSessionId, mockUserId],
      ]);
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
        expect(sessions.invalidateSessionById).not.toHaveBeenCalled();
      },
    );

    it('should reject a malformed user id, and revoke nothing', async () => {
      await expect(
        service.revokeSession('not-an-id', otherSessionId, mockSessionId),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });
      expect(sessions.invalidateSessionById).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('should refuse without a current session', async () => {
      await expect(
        service.revokeAllOtherSessions(mockUserId, null),
      ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
      expect(
        sessions.invalidateAllSessionsExceptSession,
      ).not.toHaveBeenCalled();
    });
  });

  // feature:postgres:start
  describe('on UUID ids', () => {
    const userId = '018f4e2a-7b3c-7d10-9a5e-2c4b6d8e0f1a';
    const currentId = '018f4e2a-7b3c-7d10-9a5e-2c4b6d8e0fab';
    const otherId = '018f4e2a-7b3c-7d10-9a5e-2c4b6d8e0fcd';

    let onUuids: UserSessionsService;

    beforeEach(() => {
      sessions = createSessions(sessionOf(currentId, userId));
      onUuids = serviceOn(new PostgresIdFormat(), sessions);
    });

    it('should revoke the named session of the calling account', async () => {
      await onUuids.revokeSession(userId, otherId, currentId);

      expect(sessions.invalidateSessionById.mock.calls).toEqual([
        [otherId, userId],
      ]);
    });

    it.each([
      ['upper case', '018F4E2A-7B3C-7D10-9A5E-2C4B6D8E0FAB'],
      ['mixed case', '018f4E2a-7b3C-7d10-9A5e-2c4b6d8e0FaB'],
    ])(
      'should refuse the current session named in %s, and revoke nothing',
      async (_form, sessionId) => {
        await expect(
          onUuids.revokeSession(userId, sessionId, currentId),
        ).rejects.toMatchObject({
          code: ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
        });
        expect(sessions.invalidateSessionById).not.toHaveBeenCalled();
      },
    );
  });
  // feature:postgres:end
});
