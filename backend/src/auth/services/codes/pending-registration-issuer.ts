import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../../common/services/hash.service';
import { Clock } from '../../../common/services/clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { generateVerificationCode } from '../../utils/verification-code.util';
import { PENDING_STORE_PASSES } from '../../constants/pending-store';
import {
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  PendingPurpose,
} from '../../constants/registration';
import {
  IssuedCode,
  RegistrationDetails,
} from '../../interfaces/pending-code.interface';
import {
  CODE_ROTATION,
  LEGACY_BLOCKER,
  PendingCodeGeneration,
  PendingRegistrationKey,
  PendingRegistrationStore,
} from '../../pending-codes/pending-registration.store';

interface IssueInput {
  key: PendingRegistrationKey;
  generation: PendingCodeGeneration;
  code: string;
  now: Date;
  includeExpired: boolean;
  createWhenAbsent: boolean;
}

/**
 * Opens, refreshes, replaces or inserts a code record. Separate from code
 * verification, which only reads and deletes a record. A record holds no
 * password and no name: those arrive with the code at activation. The
 * per-address mail cap is the mail counter's responsibility.
 */
export class PendingRegistrationIssuer {
  private readonly codeExpiresIn: number;

  constructor(
    private readonly store: PendingRegistrationStore,
    private readonly hashService: HashService,
    configService: ConfigService,
    private readonly clock: Clock,
  ) {
    this.codeExpiresIn = configService.get<number>(
      'activation.codeExpiresIn',
      ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
    );
  }

  /**
   * Open or refresh the record. A live record gets a fresh code; an expired
   * record is replaced; an absent one is created. The caller mails only when
   * the mail counter allowed this address.
   */
  async createOrUpdate(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails = {},
  ): Promise<IssuedCode | null> {
    return this.issue(
      await this.newGeneration(email, purpose, details, {
        includeExpired: true,
        createWhenAbsent: true,
      }),
    );
  }

  /**
   * Reissue the code of an existing record. A live record gets a fresh code;
   * an expired record is dropped. Returns null when nothing was mailed, so
   * every caller answers the generic reply.
   */
  async resend(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails = {},
  ): Promise<IssuedCode | null> {
    return this.issue(
      await this.newGeneration(email, purpose, details, {
        includeExpired: false,
        createWhenAbsent: false,
      }),
    );
  }

  private async newGeneration(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails,
    mode: Pick<IssueInput, 'includeExpired' | 'createWhenAbsent'>,
  ): Promise<IssueInput> {
    const code = generateVerificationCode();
    const hashedCode = await this.hashService.hash(code);
    const now = this.clock.now();
    return {
      key: { email, purpose },
      generation: {
        hashedCode,
        expiresAt: new Date(now.getTime() + this.codeExpiresIn),
        userId: details.userId?.toString(),
        addressGeneration: details.addressGeneration,
      },
      code,
      now,
      ...mode,
    };
  }

  /**
   * Store the record with guarded single writes. A live record is refreshed;
   * an expired one is replaced when the caller allows it; an absent one is
   * created when the caller allows it. A legacy address confirmation under the
   * old unique email index answers null.
   */
  private async issue(input: IssueInput): Promise<IssuedCode | null> {
    const { key, generation, now } = input;
    for (let pass = 0; pass < PENDING_STORE_PASSES; pass += 1) {
      const refreshed = await this.store.rotateLiveCode(key, now, generation);
      if (refreshed === CODE_ROTATION.ROTATED) return { code: input.code };

      if (input.includeExpired) {
        const replaced = await this.store.replaceExpiredCode(
          key,
          now,
          generation,
        );
        if (replaced === CODE_ROTATION.ROTATED) return { code: input.code };
      }

      // A record that is left is expired. A resend drops it; a create path
      // already replaced it above.
      if (await this.store.hasRecord(key)) {
        if (!input.createWhenAbsent) {
          await this.store.dropExpiredRecord(key, now);
        }
        return null;
      }

      if (!input.createWhenAbsent) {
        return null;
      }

      try {
        await this.store.insertRecord(key, generation);
        return { code: input.code };
      } catch (error) {
        if (!(error instanceof UniqueConflictError)) throw error;
        // A concurrent same-purpose insert is not legacy, so the next pass
        // refreshes the record that won.
        const legacy = await this.store.clearLegacyBlocker(key.email);
        if (legacy === LEGACY_BLOCKER.CONFIRMATION_KEPT) return null;
      }
    }

    throw new AppException(
      ErrorCode.INTERNAL_ERROR,
      'Could not store the pending registration',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
