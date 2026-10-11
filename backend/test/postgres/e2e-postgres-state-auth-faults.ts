import type { INestApplication } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { ActivationAccounts } from '../../src/auth/pending-codes/activation-accounts';
import { PasswordResetCodeStore } from '../../src/auth/pending-codes/password-reset-code.store';
import { PendingRegistrationStore } from '../../src/auth/pending-codes/pending-registration.store';
import { SQLSTATE } from '../../src/common/persistence/postgres/postgres-persistence-errors';
import { RolePermissions } from '../../src/role/stores/role-permissions';
import { SessionRevocationStore } from '../../src/session/revocation/session-revocation.store';
import type { E2eAuthFaults } from '../utils/e2e-state-auth';
import { holdBefore, RaceGate } from '../utils/race-gate';
import type { CommitFaultDialect } from './postgres-commit-faults';

/** What the server answers a write it wants run again. */
function serializationFailure(): Error {
  const failure = new DatabaseError(
    'could not serialize access due to concurrent update',
    0,
    'error',
  );
  failure.code = SQLSTATE.SERIALIZATION_FAILURE;
  return failure;
}

/** Holds and faults on PostgreSQL, at the store ports and the driver's commit. */
export function postgresAuthFaults(
  app: INestApplication,
  commitFaults: CommitFaultDialect,
): E2eAuthFaults {
  const port = <Port>(token: abstract new (...args: never[]) => Port): Port =>
    app.get<Port>(token, { strict: false });

  return {
    holdPendingRegistrationInserts: (first, later) =>
      holdBefore(port(PendingRegistrationStore), 'insertRecord', (call) =>
        call === 0 ? first : later,
      ),
    holdPendingRegistrationConsumes: (gate, count) =>
      holdBefore(port(PendingRegistrationStore), 'claimCode', (call) =>
        call < count ? gate : undefined,
      ),
    holdPendingPasswordResetInserts: (first, later) =>
      holdBefore(port(PasswordResetCodeStore), 'insertRecord', (call) =>
        call === 0 ? first : later,
      ),
    failNextAccountWrite: () => {
      const spy = jest
        .spyOn(port(ActivationAccounts), 'insertActivated')
        .mockRejectedValueOnce(new Error('account write failed'));
      return () => spy.mockRestore();
    },
    failNextRoleRead: () => {
      const spy = jest
        .spyOn(port(RolePermissions), 'ofRole')
        .mockRejectedValueOnce(new Error('role read failed'));
      return () => spy.mockRestore();
    },
    // No answer to the commit and none to "what became of it": the one way
    // the server reaches an unknown outcome on this database.
    makeCommitOutcomesUnknown: (commit) =>
      commitFaults.loseCommitAnswers({ lands: commit.lands }).restore,
    abandonCommitsThenGoSilent: (gate) =>
      commitFaults.loseCommitAnswers({
        lands: false,
        beforeSilence: () => gate.hold(),
      }).restore,
    watchAccountLookupsAfterCommit: () => {
      const accounts = port(ActivationAccounts);
      const lookups = jest.fn();
      const isStored = accounts.isStored.bind(accounts);
      const findConfirmation = accounts.findAddressConfirmation.bind(accounts);
      jest.spyOn(accounts, 'isStored').mockImplementation((id) => {
        lookups();
        return isStored(id);
      });
      jest
        .spyOn(accounts, 'findAddressConfirmation')
        .mockImplementation((id) => {
          lookups();
          return findConfirmation(id);
        });
      return lookups;
    },
    failNextAccountLookupAfterCommit: () => {
      const accounts = port(ActivationAccounts);
      const failure = (): never => {
        throw new TypeError('read failed');
      };
      const spies = [
        jest.spyOn(accounts, 'isStored').mockImplementationOnce(failure),
        jest
          .spyOn(accounts, 'findAddressConfirmation')
          .mockImplementationOnce(failure),
      ];
      return () => spies.forEach((spy) => spy.mockRestore());
    },
    abortNextSessionEndingWrite: (gate: RaceGate) => {
      const store = port(SessionRevocationStore);
      let aborted = false;
      const abortOnce = async (): Promise<void> => {
        if (aborted) return;
        aborted = true;
        await gate.hold();
        throw serializationFailure();
      };
      const advance = store.advanceAccountVersion.bind(store);
      const advanceFrom = store.advanceAccountVersionFrom.bind(store);
      const spies = [
        jest
          .spyOn(store, 'advanceAccountVersion')
          .mockImplementation(async (...args) => {
            await abortOnce();
            return advance(...args);
          }),
        jest
          .spyOn(store, 'advanceAccountVersionFrom')
          .mockImplementation(async (...args) => {
            await abortOnce();
            return advanceFrom(...args);
          }),
      ];
      return () => spies.forEach((spy) => spy.mockRestore());
    },
  };
}
