import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { ValidationFailedException } from '../../../common/exceptions/validation-failed.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { FRESH_PROOF_REQUIREMENT } from '../../../auth/contracts/constants/fresh-proof';
import {
  FreshProofGate,
  type FreshProofRequirement,
} from '../../../auth/proof/fresh-proof-gate';
import { FRESH_PROOF_REQUIRED } from '../../../auth/proof/constants/proof';
import type { ActingSession } from '../../../auth/proof/types/acting-session';

/** Whether ADMIN_STRICT_MUTATIONS is on, read from the parsed configuration. */
export function strictMutationsOn(config: ConfigService): boolean {
  return config.get<boolean>('admin.strictMutations') === true;
}

/**
 * The three rules of a strict staff mutation: a fresh proof, the version it
 * read and, on a create, an idempotency key. Off, a request without them is
 * served as before; a version or a key that is sent is honoured either way.
 * An action that touches an administrator always needs an act.
 */
@Injectable()
export class StaffMutationPolicy {
  constructor(
    private readonly config: ConfigService,
    private readonly proofs: FreshProofGate,
  ) {}

  get strict(): boolean {
    return strictMutationsOn(this.config);
  }

  /**
   * A guarded route in strict mode: an act, or a sign-in inside the window.
   * A caller with no session, such as an internal one, has no proof to give.
   */
  async assertRouteProof(
    unitOfWork: UnitOfWork,
    session: ActingSession | undefined,
  ): Promise<void> {
    if (!this.strict) return;
    await this.assertFresh(
      unitOfWork,
      session,
      FRESH_PROOF_REQUIREMENT.ACT_OR_AGE,
    );
  }

  /** Inviting, resetting or changing the address of an administrator, in either mode. */
  assertAct(
    unitOfWork: UnitOfWork,
    session: ActingSession | undefined,
  ): Promise<void> {
    return this.assertFresh(unitOfWork, session, FRESH_PROOF_REQUIREMENT.ACT);
  }

  /**
   * @throws AppException CONFLICT when a sent version is not the current one
   * @throws ValidationFailedException when strict mode gets no version
   */
  assertVersion(sent: number | undefined, current: number | undefined): void {
    if (sent === undefined) {
      if (this.strict) throw missing('version', 'version is required');
      return;
    }
    if (sent !== (current ?? 0)) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'The record changed since it was read',
        HttpStatus.CONFLICT,
        { version: current ?? 0 },
      );
    }
  }

  /** @throws ValidationFailedException when strict mode gets a create with no key */
  assertKey(key: string | undefined): void {
    if (key === undefined && this.strict) {
      throw missing('idempotencyKey', 'Idempotency-Key is required');
    }
  }

  private async assertFresh(
    unitOfWork: UnitOfWork,
    session: ActingSession | undefined,
    requirement: FreshProofRequirement,
  ): Promise<void> {
    if (!session) {
      throw new AppException(
        ErrorCode.REAUTH_REQUIRED,
        'A fresh proof from a signed-in session is required',
        HttpStatus.UNAUTHORIZED,
        { required: FRESH_PROOF_REQUIRED, methods: [] },
      );
    }
    await this.proofs.assertFresh(unitOfWork, session, requirement);
  }
}

function missing(field: string, message: string): ValidationFailedException {
  return new ValidationFailedException(
    { [field]: [message] },
    { fieldNames: [field], omittedCount: 0 },
  );
}
