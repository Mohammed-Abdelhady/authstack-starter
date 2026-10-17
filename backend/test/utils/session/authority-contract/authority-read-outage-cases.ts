import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { AppException } from '../../../../src/common/exceptions/app.exception';
import {
  PersistenceTimeoutError,
  PersistenceUnavailableError,
} from '../../../../src/common/persistence/persistence-errors';
import {
  AuthorityHarnessSource,
  failAfter,
  signIn,
} from './authority-contract-support';

export function authorityReadOutageCases(
  harness: AuthorityHarnessSource,
): void {
  let restores: Array<() => void> = [];
  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  it.each(['list', 'id', 'token', 'validation'] as const)(
    'refuses authority with 503 when the %s read fails',
    async (operation) => {
      const h = harness();
      const userId = await h.issuance.seedAccount();
      const { token, sessionId } = await signIn(h, userId);
      const validator = h.validator();
      const method = {
        list: 'listSessionCandidates',
        id: 'findSessionById',
        token: 'findSessionByTokenHash',
        validation: 'readCommittedSessionByTokenHash',
      } as const;
      restores.push(
        failAfter(
          h.authorityStore,
          method[operation],
          operation === 'validation'
            ? new PersistenceTimeoutError()
            : new PersistenceUnavailableError(),
        ),
      );
      const calls = {
        list: () => validator.listActive(userId),
        id: () => validator.findById(sessionId),
        token: () => validator.findByToken(token),
        validation: () => validator.validateByToken(token, false),
      };
      let refusal: unknown;
      try {
        await calls[operation]();
      } catch (error) {
        refusal = error;
      }
      expect(
        refusal instanceof AppException
          ? { code: refusal.code, status: refusal.getStatus() }
          : refusal,
      ).toEqual({
        code: ErrorCode.AUTHORITY_UNAVAILABLE,
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    },
  );
}
