import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationPolicyReader } from '../../auth/contracts/application-policy';
import type { IssuancePolicy } from '../../auth/contracts/types/application-policy';
import { AuthFeature } from '../../auth/enums/auth-feature.enum';
import { AuthFeaturesService } from '../../auth/services/features/auth-features.service';
import { PasskeyConfigService } from '../../auth/passkeys/services/passkey-config.service'; // feature:passkeys
import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import { nativePasskeysAvailable } from '../../config/utils/native-passkeys-available';
import type { PasskeyRelyingParty } from '../../auth/contracts/types/passkey-relying-party';
import type { BrowserSignInConfiguration } from '../../config/types/host-policy.type';
import type {
  NativeApplicationConfiguration,
  NativeSignInConfiguration,
} from '../../config/types/native-application.type';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID, // feature:passkeys
} from '../constants/client-ids';
import type { IssuanceApplication } from '../issuance/browser-issuance.store';
import { IssuanceApplications } from '../issuance/issuance-applications';

@Injectable()
export class StoredApplicationPolicyReader extends ApplicationPolicyReader {
  constructor(
    private readonly applications: IssuanceApplications,
    private readonly config: ConfigService,
    private readonly features: AuthFeaturesService,
    private readonly passkeys: PasskeyConfigService, // feature:passkeys
  ) {
    super();
  }

  async requireEnabled(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuancePolicy> {
    const application = await this.applications.requireEnabled(
      unitOfWork,
      clientId,
    );
    const signIn =
      application.platform === APPLICATION_PLATFORM.NATIVE
        ? this.nativeApplication(clientId)?.signIn
        : undefined;
    return {
      ...application,
      signIn,
      passkeyRelyingParty: this.relyingParty(application, signIn),
    };
  }

  private relyingParty(
    application: IssuanceApplication,
    signIn: NativeSignInConfiguration | undefined,
  ): PasskeyRelyingParty | null {
    if (!this.features.isEnabled(AuthFeature.PASSKEYS)) return null;
    if (application.platform === APPLICATION_PLATFORM.NATIVE) {
      if (!nativePasskeysAvailable(signIn)) {
        return null;
      }
      return { rpId: signIn.rpId, origins: [...signIn.origins] };
    }
    const browserSignIn = this.config.get<BrowserSignInConfiguration>(
      `auth.${application.clientId}.signIn`,
    );
    if (browserSignIn?.passkeys === false) return null;
    if (application.clientId === ADMIN_CLIENT_ID) {
      const adminUrl = this.config.get<string>('cors.adminUrl');
      if (!adminUrl) return null;
      const url = new URL(adminUrl);
      return { rpId: url.hostname, origins: [url.origin] };
    }
    // feature:passkeys:start
    if (application.clientId === WEB_CLIENT_ID) {
      return { rpId: this.passkeys.rpId, origins: [this.passkeys.origin] };
    }
    // feature:passkeys:end
    return null;
  }

  private nativeApplication(clientId: string) {
    return this.config
      .get<NativeApplicationConfiguration[]>('auth.nativeApplications', [])
      .find((application) => application.clientId === clientId);
  }
}
