import { HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';
import { ApplicationPolicyReader } from '../../contracts/application-policy';
import type { PasskeyRelyingParty } from '../../contracts/types/passkey-relying-party';

/** What a browser passkey ceremony is held to. */
export interface BrowserPasskeyCeremony {
  readonly clientId: BrowserApplicationId;
  /** Where its passkeys are scoped to, and the exact origins it may come from. */
  readonly relyingParty: PasskeyRelyingParty;
  /** The application lets its users in with a passkey only. */
  readonly requirePasskey: boolean;
}

/**
 * The relying party and passkey rule of the browser application a request is
 * for, read from that application's stored policy. The web application keeps
 * the configured relying party; the admin one has its own, from its address.
 */
@Injectable()
export class BrowserPasskeyPolicy {
  constructor(
    private readonly applications: BrowserApplications,
    private readonly runner: UnitOfWorkRunner,
    private readonly policies: ApplicationPolicyReader,
  ) {}

  /** @throws AppException FEATURE_DISABLED when that application makes no passkeys */
  async of(request: Request | undefined): Promise<BrowserPasskeyCeremony> {
    const { clientId } = await this.applications.resolve(request);
    const policy = await this.runner.run((work) =>
      this.policies.requireEnabled(work, clientId),
    );
    if (!policy.passkeyRelyingParty) {
      throw new AppException(
        ErrorCode.FEATURE_DISABLED,
        'This sign-in method is not available',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      clientId,
      relyingParty: policy.passkeyRelyingParty,
      requirePasskey: policy.requirePasskey === true,
    };
  }
}
