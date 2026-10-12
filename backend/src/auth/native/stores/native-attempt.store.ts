import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  NativeAttempt,
  NativeAttemptCredentials,
  NativeAttemptGuard,
  NativeAttemptOperationGuard,
  NativeAttemptTransition,
  NewNativeAttempt,
} from '../types/native-attempt';

/** False or null is a refused guard, including expiry and terminal state. */
export abstract class NativeAttemptStore {
  abstract create(input: NewNativeAttempt): Promise<NativeAttempt>;
  abstract findByCredentials(
    credentials: NativeAttemptCredentials,
  ): Promise<NativeAttempt | null>;
  /** Authenticates before lifecycle checks; preserves expired and terminal metadata. */
  abstract findAuthenticated(
    attemptId: string,
    secretHash: string,
  ): Promise<NativeAttempt | null>;
  abstract claim(
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null>;
  abstract claimIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null>;
  abstract release(guard: NativeAttemptOperationGuard): Promise<boolean>;
  abstract releaseIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptOperationGuard,
  ): Promise<boolean>;
  abstract transition(
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null>;
  abstract transitionIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null>;
  abstract cancel(guard: NativeAttemptGuard): Promise<boolean>;
  abstract cancelIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptGuard,
  ): Promise<boolean>;
}
