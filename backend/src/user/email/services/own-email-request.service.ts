import { Injectable } from '@nestjs/common';
import { PENDING_PURPOSE } from '../../../auth/constants/registration';
import { CODE_ROTATION } from '../../../auth/pending-codes/pending-registration.store';
import { ActivationAccounts } from '../../../auth/pending-codes/activation-accounts';
import { VerificationCodeService } from '../../../auth/services/codes/verification-code.service';
import type { PreparedEmailChange } from '../../../auth/types/prepared-email-change';
import {
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  AddressLedger,
} from '../../../common/persistence/address-ledger';
import { storedAddress } from '../../../common/persistence/stored-address';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';
import { SECURITY_NOTICE } from '../../constants/security-notice.constants';
import { SecurityNoticeService } from '../../services/security-notice.service';
import { AccountSessions } from '../../stores/account-sessions';
import type {
  OwnEmailCaller,
  OwnEmailProof,
  OwnEmailState,
} from '../types/own-email';
import {
  AddressClaimLostError,
  asOwnEmailFailure,
  changedMeanwhile,
  limitReached,
  sameAddress,
  sessionEnded,
} from '../utils/own-email-errors';
import { OwnEmailMailService } from './own-email-mail.service';
import { OwnEmailProofService } from './own-email-proof.service';

/** One request as it is about to be stored. */
interface PendingRequest {
  caller: OwnEmailCaller;
  proof: OwnEmailProof;
  address: string;
  prepared: PreparedEmailChange;
  /** The generation read before the code was prepared for the next one. */
  readGeneration: number;
}

/** What the unit of work that stored a request leaves to do after commit. */
interface StoredRequest {
  claimed: boolean;
  /** The address the account has, read as the request committed. */
  current: MailRecipient;
  at: Date;
}

/**
 * The account holder asks to move the account to another address, or stops
 * asking. The address is held in the ledger until the change is confirmed,
 * cancelled or lapses. An address that is held elsewhere is answered exactly
 * like a free one: it is stored as pending, the old address is told, and only
 * the code never comes, so the code step is where it fails.
 */
@Injectable()
export class OwnEmailRequestService {
  constructor(
    private readonly accounts: ActivationAccounts,
    private readonly codes: VerificationCodeService,
    private readonly ledger: AddressLedger,
    private readonly proofs: OwnEmailProofService,
    private readonly sessions: AccountSessions,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly mail: OwnEmailMailService,
    private readonly notices: SecurityNoticeService,
  ) {}

  async read(userId: string): Promise<OwnEmailState> {
    const current = await this.accounts
      .findAddressConfirmation(userId)
      .catch(asOwnEmailFailure);
    if (!current) throw sessionEnded();
    return stateOf(current.email, current.pendingEmail);
  }

  /**
   * @param password - The account's password, when the session alone cannot
   *   prove who is asking
   * @throws ValidationFailedException when the address is the account's own
   * @throws AppException REAUTH_REQUIRED without a fresh proof,
   *   INVALID_CURRENT_PASSWORD for a wrong password, EMAIL_SEND_LIMIT_REACHED
   *   when the address had its codes, CONFLICT when the address changed while
   *   the request was prepared
   */
  request(
    caller: OwnEmailCaller,
    email: string,
    password?: string,
  ): Promise<OwnEmailState> {
    return this.requestChange(caller, storedAddress(email), password).catch(
      asOwnEmailFailure,
    );
  }

  /**
   * Clears the pending address and kills its code. Nothing pending is fine.
   * It needs the proof a request needs: a change staff started is stored the
   * same way, and an idle session must not undo it.
   *
   * @throws AppException REAUTH_REQUIRED without a fresh proof,
   *   INVALID_CURRENT_PASSWORD for a wrong password
   */
  cancel(caller: OwnEmailCaller, password?: string): Promise<OwnEmailState> {
    return this.cancelChange(caller, password).catch(asOwnEmailFailure);
  }

  private async cancelChange(
    caller: OwnEmailCaller,
    password: string | undefined,
  ): Promise<OwnEmailState> {
    const proof = await this.proofs.prove(caller, password);
    return this.runner.run(async (unitOfWork) => {
      await this.proofs.assertStillProvedIn(unitOfWork, caller, proof);
      return this.cancelIn(unitOfWork, caller);
    });
  }

  private async requestChange(
    caller: OwnEmailCaller,
    address: string,
    password: string | undefined,
  ): Promise<OwnEmailState> {
    // Refused before a code is hashed or a mail slot is spent.
    const proof = await this.proofs.prove(caller, password);
    const current = await this.accounts.findAddressConfirmation(caller.userId);
    if (!current) throw sessionEnded();
    if (storedAddress(current.email) === address) throw sameAddress();

    // Prepared for a held address too: the cap and the hashing cost the same.
    const prepared = await this.codes.prepareEmailChange(
      address,
      {
        userId: caller.userId,
        addressGeneration: current.addressGeneration + 1,
      },
      PENDING_PURPOSE.OWN_EMAIL_CHANGE,
    );
    if (!prepared) throw limitReached();

    const stored = await this.store({
      caller,
      proof,
      address,
      prepared,
      readGeneration: current.addressGeneration,
    });
    if (stored.claimed) {
      this.mail.deferCode(
        { email: address, locale: stored.current.locale },
        prepared.code,
      );
    }
    this.notices.deferTo(
      stored.current,
      SECURITY_NOTICE.EMAIL_CHANGE_REQUESTED,
      { at: stored.at },
    );
    return stateOf(stored.current.email, address);
  }

  private async cancelIn(
    unitOfWork: UnitOfWork,
    caller: OwnEmailCaller,
  ): Promise<OwnEmailState> {
    const account = await this.accounts.readMovedAccount(
      unitOfWork,
      caller.userId,
    );
    if (!account) throw sessionEnded();
    if (account.pendingEmail === undefined) return stateOf(account.email);
    await this.ledger.release(unitOfWork, {
      address: account.pendingEmail,
      owner: caller.userId,
    });
    await this.accounts.savePendingAddress(unitOfWork, account, {
      email: null,
      addressGeneration: account.addressGeneration + 1,
    });
    return stateOf(account.email);
  }

  private async store(request: PendingRequest): Promise<StoredRequest> {
    try {
      return await this.runner.run((unitOfWork) =>
        this.storeIn(unitOfWork, request, true),
      );
    } catch (error) {
      if (!(error instanceof AddressClaimLostError)) throw error;
      return this.runner.run((unitOfWork) =>
        this.storeIn(unitOfWork, request, false),
      );
    }
  }

  private async storeIn(
    unitOfWork: UnitOfWork,
    request: PendingRequest,
    mayClaim: boolean,
  ): Promise<StoredRequest> {
    const { caller, address, prepared } = request;
    await this.proofs.assertStillProvedIn(unitOfWork, caller, request.proof);
    const account = await this.accounts.readMovedAccount(
      unitOfWork,
      caller.userId,
    );
    if (!account) throw sessionEnded();
    // A confirm elsewhere may have ended this session without moving the
    // generation, so the session is read again with the account taken.
    await this.sessions.assertLive(unitOfWork, caller.userId, caller.sessionId);
    if (account.addressGeneration !== request.readGeneration) {
      throw changedMeanwhile();
    }
    if (storedAddress(account.email) === address) throw sameAddress();
    const now = this.clock.now();
    await this.releaseOtherClaim(unitOfWork, request, account.pendingEmail);
    const claimed = mayClaim && (await this.claim(unitOfWork, request, now));
    if (
      claimed &&
      (await this.codes.storeEmailChangeIn(unitOfWork, prepared)) !==
        CODE_ROTATION.ROTATED
    ) {
      throw changedMeanwhile();
    }
    await this.accounts.savePendingAddress(unitOfWork, account, {
      email: address,
      addressGeneration: prepared.generation.addressGeneration,
    });
    return {
      claimed,
      current: { email: account.email, locale: account.locale },
      at: now,
    };
  }

  /** Moving on to another address frees the one asked for before. */
  private async releaseOtherClaim(
    unitOfWork: UnitOfWork,
    request: PendingRequest,
    pendingEmail: string | undefined,
  ): Promise<void> {
    if (
      pendingEmail === undefined ||
      storedAddress(pendingEmail) === request.address
    ) {
      return;
    }
    await this.ledger.release(unitOfWork, {
      address: pendingEmail,
      owner: request.caller.userId,
    });
  }

  /** False for a held address. A claim lost to a race rolls the work back. */
  private async claim(
    unitOfWork: UnitOfWork,
    request: PendingRequest,
    now: Date,
  ): Promise<boolean> {
    const owner = request.caller.userId;
    const free = await this.ledger.isFree(unitOfWork, {
      address: request.address,
      now,
      owner,
    });
    if (!free) return false;
    const result = await this.ledger.claim(unitOfWork, {
      address: request.address,
      owner,
      kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
      now,
      lapsesAt: request.prepared.generation.expiresAt,
    });
    if (result === ADDRESS_CLAIM_RESULT.TAKEN) {
      throw new AddressClaimLostError();
    }
    return true;
  }
}

function stateOf(email: string, pendingEmail?: string): OwnEmailState {
  return pendingEmail === undefined ? { email } : { email, pendingEmail };
}
