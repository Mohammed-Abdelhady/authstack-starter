import { ErasureLock } from '../../../src/auth/contracts/erasure-lock';
import { HashService } from '../../../src/common/services/hash.service';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationPolicyReader } from '../../../src/auth/contracts/application-policy';
import { EventRecorder } from '../../../src/auth/contracts/event-recorder';
import type { IssuancePolicy } from '../../../src/auth/contracts/types/application-policy';
import { FRESH_PROOF_REQUIRED } from '../../../src/auth/proof/constants/proof';
import { FreshProofGate } from '../../../src/auth/proof/fresh-proof-gate';
import { LastAdminGuard } from '../../../src/admin/services/staff-mutations/last-admin-guard';
import { StaffIdempotency } from '../../../src/admin/services/staff-mutations/staff-idempotency.service';
import { StaffMutationPolicy } from '../../../src/admin/services/staff-mutations/staff-mutation-policy';
import { StaffMutationRules } from '../../../src/admin/services/staff-mutations/staff-mutation-rules';
import { AdminRosterStore } from '../../../src/admin/stores/admin-roster.store';
import { StaffIdempotencyStore } from '../../../src/admin/stores/staff-idempotency.store';
import type { IdempotencyClaim } from '../../../src/admin/types/staff-idempotency';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { AppException } from '../../../src/common/exceptions/app.exception';
import { Clock } from '../../../src/common/services/clock';
import type { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import { APPLICATION_PLATFORM } from '../../../src/session/constants/client-ids';

/** A session that made no proof: every act the rules ask for is refused. */
export class NoProofGate extends FreshProofGate {
  assertFresh(): Promise<void> {
    return Promise.reject(
      new AppException(
        ErrorCode.REAUTH_REQUIRED,
        'No fresh proof',
        HttpStatus.UNAUTHORIZED,
        { required: FRESH_PROOF_REQUIRED, methods: [] },
      ),
    );
  }
}

/** For suites that send no idempotency key: any claim is a mistake in the suite. */
class UnclaimedIdempotencyStore extends StaffIdempotencyStore {
  claim(): Promise<IdempotencyClaim> {
    return Promise.reject(new Error('This suite sends no idempotency key'));
  }

  complete(): Promise<void> {
    return Promise.reject(new Error('This suite sends no idempotency key'));
  }
}

/** For suites that do not read the staff log. */
class DiscardedEvents extends EventRecorder {
  record(): Promise<void> {
    return Promise.resolve();
  }

  recordMany(): Promise<void> {
    return Promise.resolve();
  }

  recordRoleDeletion(): Promise<void> {
    return Promise.resolve();
  }

  recordOutsideUnitOfWork(): Promise<void> {
    return Promise.resolve();
  }
}

/** Staff mutation rules with strict mode as `config` says, off by default. */
export function testStaffMutationRules(
  options: { config?: ConfigService; events?: EventRecorder } = {},
): StaffMutationRules {
  const config = options.config ?? new ConfigService({});
  return new StaffMutationRules(
    new StaffMutationPolicy(config, new NoProofGate()),
    new StaffIdempotency(
      new UnclaimedIdempotencyStore(),
      new Clock(),
      new HashService(new ConfigService()),
    ),
    options.events ?? new DiscardedEvents(),
  );
}

export function testStaffMutationPolicy(
  config: ConfigService = new ConfigService({}),
): StaffMutationPolicy {
  return new StaffMutationPolicy(config, new NoProofGate());
}

class CountedRoster extends AdminRosterStore {
  constructor(private readonly count: number) {
    super();
  }

  lock(): Promise<void> {
    return Promise.resolve();
  }

  countAdminsWhoCanSignIn(): Promise<number> {
    return Promise.resolve(this.count);
  }

  hasActiveAdministrator(): Promise<boolean> {
    return Promise.resolve(this.count > 0);
  }
}

class OpenApplicationPolicy extends ApplicationPolicyReader {
  requireEnabled(
    _unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuancePolicy> {
    return Promise.resolve({
      clientId,
      platform: APPLICATION_PLATFORM.ADMIN,
      allowedScopes: [],
      enabled: true,
      sessionVersion: 0,
      policy: { absoluteLifetimeMs: 1, idleLifetimeMs: 1 },
      passkeyRelyingParty: null,
    });
  }
}

/** The last-administrator rule over a roster that always counts `count` others. */
export function testLastAdminGuard(count = 1): LastAdminGuard {
  return new LastAdminGuard(
    new CountedRoster(count),
    new OpenApplicationPolicy(),
    new ConfigService({}),
  );
}

export class NoErasureLock extends ErasureLock {
  assertRestorable(): Promise<void> {
    return Promise.resolve();
  }
}
