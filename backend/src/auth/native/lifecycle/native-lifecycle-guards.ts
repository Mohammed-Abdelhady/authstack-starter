import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeMethodsService } from '../services/native-methods.service';
import { featureDisabled, wrongStage } from '../utils/native-attempt-errors';
import {
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import type {
  NativeAttempt,
  NativeAttemptPhase,
} from '../types/native-attempt';

export const NATIVE_LIFECYCLE_CAPABILITY = {
  EMAIL_LINK: 'emailLink',
  REGISTRATION: 'registration',
  RECOVERY: 'recovery',
} as const;

export type NativeLifecycleCapability =
  (typeof NATIVE_LIFECYCLE_CAPABILITY)[keyof typeof NATIVE_LIFECYCLE_CAPABILITY];

export async function requireLifecycleAttempt(
  attempts: NativeAttemptService,
  methods: NativeMethodsService,
  attemptId: string,
  secret: string,
  flow: (typeof NATIVE_ATTEMPT_FLOW)[keyof typeof NATIVE_ATTEMPT_FLOW],
  phases: NativeAttemptPhase[],
  capability: NativeLifecycleCapability,
): Promise<NativeAttempt> {
  const attempt = await attempts.authenticate(attemptId, secret);
  const client = await methods.forClient(attempt.clientId);
  if (!client.nativeEnabled || !client.capabilities[capability]) {
    throw featureDisabled();
  }
  if (attempt.flow !== flow || !phases.includes(attempt.phase)) {
    throw wrongStage();
  }
  return attempt;
}

export const NATIVE_LIFECYCLE_REQUEST_PHASES = {
  EMAIL_LINK: [
    NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
  ],
  REGISTRATION: [
    NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED,
  ],
  RECOVERY: [
    NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    NATIVE_ATTEMPT_PHASE.RECOVERY_CODE_REQUIRED,
  ],
} as const;
