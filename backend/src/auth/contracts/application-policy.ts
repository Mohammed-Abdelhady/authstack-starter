import type { RoleAudience } from '../../host/types/host-role.type';
import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { IssuancePolicy } from './types/application-policy';

/** Stored admission policy and the relying party available to the application. */
export abstract class ApplicationPolicyReader {
  abstract requireEnabled(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuancePolicy>;
}

export function requiredRelyingParties(
  policies: readonly IssuancePolicy[],
  audience: RoleAudience | null,
): string[] {
  const relyingParties = new Set<string>();
  for (const policy of policies) {
    if (
      (!policy.accountAudience || policy.accountAudience === audience) &&
      policy.requirePasskey &&
      policy.passkeyRelyingParty
    ) {
      relyingParties.add(policy.passkeyRelyingParty.rpId);
    }
  }
  return [...relyingParties];
}
