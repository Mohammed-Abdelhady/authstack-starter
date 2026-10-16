import { Injectable } from '@nestjs/common';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';

/** The relying party an application's passkeys belong to. */
export interface PasskeyRelyingParty {
  rpId: string;
  /** Exact origins its ceremonies may come from, never matched by suffix. */
  origins: readonly string[];
}

/**
 * The one place a native application's relying party is resolved, from
 * `signIn.rpId` and `signIn.origins`. An application without both makes no
 * passkeys; the browser routes keep the web relying party as before.
 */
@Injectable()
export class NativeRelyingParties {
  constructor(private readonly epoch: AuthEpochService) {}

  of(clientId: string): PasskeyRelyingParty | null {
    const signIn = this.epoch
      .nativeApplications()
      .find((application) => application.clientId === clientId)?.signIn;
    if (!signIn?.rpId || !signIn.origins?.length) {
      return null;
    }
    return { rpId: signIn.rpId, origins: [...signIn.origins] };
  }
}
