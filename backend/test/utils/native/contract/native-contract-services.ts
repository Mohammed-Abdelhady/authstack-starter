import { ConfigService } from '@nestjs/config';
import { UnitOfWorkRunner } from '../../../../src/common/persistence/unit-of-work';
import { AuthEpochService } from '../../../../src/common/services/auth-epoch.service';
import { ApplicationAccess } from '../../../../src/session/applications/application-access';
import { ApplicationRegistry } from '../../../../src/session/applications/application-registry';
import { AuthorityApplications } from '../../../../src/session/authority/authority-applications';
import { SessionAuthorityStore } from '../../../../src/session/authority/session-authority.store';
import { SessionValidator } from '../../../../src/session/authority/session-validator';
import { BrowserIssuanceStore } from '../../../../src/session/issuance/browser-issuance.store';
import { IssuanceApplications } from '../../../../src/session/issuance/issuance-applications';
import { NativeAccessValidator } from '../../../../src/session/native/access/native-access-validator';
import { NativeAuthorizeBrowserService } from '../../../../src/session/native/authorize/native-authorize-browser.service';
import { NativeAuthorizeService } from '../../../../src/session/native/authorize/native-authorize.service';
import {
  NATIVE_DPOP_TEST_SECRET,
  NATIVE_PUBLIC_API_ORIGIN,
} from '../../../../src/session/native/harness/native-dpop-test-vectors.harness-spec';
import { NativeBoundProofService } from '../../../../src/session/native/proof/native-bound-proof.service';
import { NativeDpopService } from '../../../../src/session/native/proof/native-dpop.service';
import { NativeRefreshRotationService } from '../../../../src/session/native/refresh/native-refresh-rotation.service';
import { NativeRefreshService } from '../../../../src/session/native/refresh/native-refresh.service';
import { NativeBoundRetryService } from '../../../../src/session/native/retry/native-bound-retry.service';
import { NativeRevokeService } from '../../../../src/session/native/revoke/native-revoke.service';
import { NativeCredentialIssuer } from '../../../../src/session/native/token/native-credential.issuer';
import { NativeTokenService } from '../../../../src/session/native/token/native-token.service';
import { SessionRevocationStore } from '../../../../src/session/revocation/session-revocation.store';
import { NativeSessionRevocationService } from '../../../../src/session/services/native-session-revocation.service';
import { SessionIssuanceService } from '../../../../src/session/services/session-issuance.service';
import { FrozenClock } from '../../frozen-clock';
import {
  CONTRACT_AUTH_EPOCH,
  CONTRACT_ENVIRONMENT,
} from '../../session/issuance-contract/issuance-contract-harness';
import {
  NativeServiceOptions,
  NativeServices,
  NativeStores,
} from './native-contract-harness';

/** What a database hands over besides the stores under test. */
export interface NativeServiceParts {
  runner: UnitOfWorkRunner;
  clock: FrozenClock;
  stores: NativeStores;
  issuanceStore: BrowserIssuanceStore;
  issuanceApplications: IssuanceApplications;
  revocationStore: SessionRevocationStore;
  authorityStore: SessionAuthorityStore;
  authorityApplications: AuthorityApplications;
}

export function nativeConfig(options: NativeServiceOptions): ConfigService {
  return new ConfigService({
    auth: {
      epoch: options.authEpoch ?? CONTRACT_AUTH_EPOCH,
      nativeEnabled: options.nativeEnabled ?? true,
      nativeDpopRequired: options.dpopRequired ?? false,
      nativeDpopNonceSecret: NATIVE_DPOP_TEST_SECRET,
    },
    server: { nodeEnv: CONTRACT_ENVIRONMENT, apiUrl: NATIVE_PUBLIC_API_ORIGIN },
  });
}

/**
 * The service graph the application wires, built by hand on one database's
 * stores. It names no driver, so both databases build it the same way.
 */
export function buildNativeServices(
  parts: NativeServiceParts,
  options: NativeServiceOptions,
): NativeServices {
  const { runner, clock, stores } = parts;
  const config = nativeConfig(options);
  const authEpoch = new AuthEpochService(config);
  const registry = new ApplicationRegistry(runner, stores.registry, authEpoch);
  const applications = new ApplicationAccess(runner, stores.grants, authEpoch);
  const issuer = new NativeCredentialIssuer(
    stores.credentials,
    stores.events,
    authEpoch,
  );
  const dpop = new NativeDpopService(stores.credentials, config);
  const boundProofs = new NativeBoundProofService(dpop, stores.events);
  const rotation = new NativeRefreshRotationService(stores.rotations, issuer);
  const retries = new NativeBoundRetryService(
    stores.rotations,
    issuer,
    stores.events,
  );
  const refreshes = new NativeRefreshService(
    runner,
    stores.credentials,
    stores.rotations,
    registry,
    parts.issuanceStore,
    rotation,
    retries,
    boundProofs,
    clock,
    authEpoch,
  );
  const revocations = new NativeRevokeService(
    runner,
    stores.credentials,
    issuer,
    boundProofs,
    clock,
    authEpoch,
  );
  const sessionIssuance = new SessionIssuanceService(
    runner,
    parts.issuanceStore,
    parts.issuanceApplications,
    clock,
    authEpoch,
  );
  return {
    authorize: new NativeAuthorizeService(
      runner,
      stores.authorizations,
      registry,
      stores.grants,
      parts.issuanceStore,
      clock,
      authEpoch,
    ),
    browser: new NativeAuthorizeBrowserService(
      stores.authorizations,
      registry,
      applications,
      clock,
      authEpoch,
    ),
    tokens: new NativeTokenService(
      runner,
      stores.authorizations,
      registry,
      parts.issuanceStore,
      issuer,
      refreshes,
      revocations,
      sessionIssuance,
      dpop,
      stores.events,
      clock,
      authEpoch,
    ),
    rotation,
    retries,
    access: new NativeAccessValidator(
      stores.access,
      new SessionValidator(
        parts.authorityStore,
        parts.authorityApplications,
        clock,
        authEpoch,
      ),
      clock,
      authEpoch,
    ),
    signOut: new NativeSessionRevocationService(
      runner,
      stores.credentials,
      parts.revocationStore,
      stores.events,
      clock,
    ),
    applications,
  };
}
