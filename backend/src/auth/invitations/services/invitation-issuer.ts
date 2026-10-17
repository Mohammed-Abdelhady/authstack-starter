import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  AddressLedger,
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
} from '../../../common/persistence/address-ledger';
import { storedAddress } from '../../../common/persistence/stored-address';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import {
  hashToken,
  randomSecret,
} from '../../../session/utils/hashing/token-hash';
import {
  INVITATION_KEEP_AFTER_EXPIRY_MS,
  INVITATION_PURPOSE,
} from '../constants/invitations';
import { InvitationStore } from '../stores/invitation.store';
import { StoredInvitation } from '../types/invitation';
import {
  InvitationIssueInput,
  IssuedInvitation,
} from '../types/invitation-issue';
import { invitationClientId } from '../utils/invitation-application';
import { invalidInvitation } from '../utils/invitation-validity';

@Injectable()
export class InvitationIssuer {
  constructor(
    private readonly invitations: InvitationStore,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
  ) {}

  async issue(
    work: UnitOfWork,
    input: InvitationIssueInput,
  ): Promise<IssuedInvitation> {
    const now = this.clock.now();
    const expiresAt = this.expiry(now, input.lifetimeMs);
    invitationClientId(input.clientId);
    if (input.purpose === INVITATION_PURPOSE.ENROLMENT) {
      if (!input.userId || input.addressGeneration === undefined)
        throw invalidInvitation();
      await this.invitations.revokeOpenEnrolmentLinks(work, input.userId, now);
    } else if (!input.role || input.userId) {
      throw invalidInvitation();
    }
    const token = randomSecret();
    const invitation = await this.invitations.insert(work, {
      purpose: input.purpose,
      email: storedAddress(input.email),
      name: input.name,
      roleId: input.role?.id,
      roleSlug: input.role?.slug,
      audience: input.role?.audience ?? input.audience,
      invitedBy: input.invitedBy,
      userId: input.userId,
      addressGeneration:
        input.purpose === INVITATION_PURPOSE.ENROLMENT
          ? input.addressGeneration
          : undefined,
      locale: input.locale,
      clientId: input.clientId,
      tokenHash: hashToken(token),
      expiresAt,
      purgeAfter: new Date(
        expiresAt.getTime() + INVITATION_KEEP_AFTER_EXPIRY_MS,
      ),
      now,
    });
    await this.claim(work, invitation, expiresAt, now);
    return { invitation, token };
  }

  async reissue(
    work: UnitOfWork,
    invitation: StoredInvitation,
    lifetimeMs: number,
  ): Promise<string> {
    const current = await this.invitations.takeById(work, invitation.id);
    if (!current || current.acceptedAt || current.revokedAt)
      throw invalidInvitation();
    const now = this.clock.now();
    const expiresAt = this.expiry(now, lifetimeMs);
    await this.claim(work, current, expiresAt, now);
    const token = randomSecret();
    await this.invitations.replaceToken(work, current.id, {
      tokenHash: hashToken(token),
      expiresAt,
      purgeAfter: new Date(
        expiresAt.getTime() + INVITATION_KEEP_AFTER_EXPIRY_MS,
      ),
      now,
    });
    return token;
  }

  async revoke(
    work: UnitOfWork,
    invitation: StoredInvitation,
    at: Date,
  ): Promise<void> {
    const current = await this.invitations.takeById(work, invitation.id);
    if (!current || current.acceptedAt) throw invalidInvitation();
    await this.invitations.markRevoked(work, current.id, at);
    if (current.purpose !== INVITATION_PURPOSE.ENROLMENT) {
      await this.ledger.release(work, {
        address: current.email,
        owner: current.id,
      });
    }
  }

  private async claim(
    work: UnitOfWork,
    invitation: StoredInvitation,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    if (invitation.purpose === INVITATION_PURPOSE.ENROLMENT) return;
    const claimed = await this.ledger.claim(work, {
      address: invitation.email,
      kind: ADDRESS_CLAIM_KIND.INVITATION,
      owner: invitation.id,
      lapsesAt: expiresAt,
      now,
    });
    if (claimed === ADDRESS_CLAIM_RESULT.TAKEN) {
      throw new AppException(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email already in use',
        HttpStatus.CONFLICT,
      );
    }
  }

  private expiry(now: Date, lifetimeMs: number): Date {
    const expiresAt = new Date(now.getTime() + lifetimeMs);
    if (
      !Number.isFinite(lifetimeMs) ||
      lifetimeMs <= 0 ||
      !Number.isFinite(expiresAt.getTime())
    )
      throw invalidInvitation();
    return expiresAt;
  }
}
