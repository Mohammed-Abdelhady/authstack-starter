import type { ApplicationPolicyWrite } from '../../applications/application-registry.store';

export function mongoApplicationPolicyFields(
  registration: ApplicationPolicyWrite,
) {
  return {
    ...(registration.signUp === undefined
      ? {}
      : { signUp: registration.signUp }),
    ...(registration.signInMethods === undefined
      ? {}
      : { signInMethods: registration.signInMethods }),
    ...(registration.requirePasskey === undefined
      ? {}
      : { requirePasskey: registration.requirePasskey }),
    ...(registration.accountAudience === undefined
      ? {}
      : { accountAudience: registration.accountAudience }),
    ...(registration.sessionCap === undefined
      ? {}
      : { sessionCap: registration.sessionCap }),
    ...(registration.policyVersion === undefined
      ? {}
      : { policyVersion: registration.policyVersion }),
    ...(registration.policy.unboundAbsoluteLifetimeMs === undefined
      ? {}
      : {
          'policy.unboundAbsoluteLifetimeMs':
            registration.policy.unboundAbsoluteLifetimeMs,
        }),
    ...(registration.policy.unboundIdleLifetimeMs === undefined
      ? {}
      : {
          'policy.unboundIdleLifetimeMs':
            registration.policy.unboundIdleLifetimeMs,
        }),
  };
}
