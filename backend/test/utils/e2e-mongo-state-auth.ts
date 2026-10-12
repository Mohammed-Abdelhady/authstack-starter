import type { INestApplication } from '@nestjs/common';
import { mongoAccountState } from './e2e-mongo-state-auth-accounts';
import { mongoAuthFaults } from './e2e-mongo-state-auth-faults';
import { mongoPendingCodeState } from './e2e-mongo-state-auth-pending';
import type { E2eAuthState } from './e2e-state-auth';

/** What the sign-up, sign-in and account cases arrange and read, on MongoDB. */
export function mongoAuthState(app: INestApplication): E2eAuthState {
  return {
    ...mongoAccountState(app),
    ...mongoPendingCodeState(app),
    ...mongoAuthFaults(app),
  };
}
