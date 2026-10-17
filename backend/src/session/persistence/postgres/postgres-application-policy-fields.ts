import type { ApplicationPolicyWrite } from '../../applications/application-registry.store';

export function postgresApplicationPolicyFields(
  registration: ApplicationPolicyWrite,
) {
  return {
    ...(registration.signUp === undefined
      ? {}
      : { sign_up: registration.signUp }),
    ...(registration.signInMethods === undefined
      ? {}
      : {
          sign_in_methods:
            registration.signInMethods === null
              ? null
              : JSON.stringify(registration.signInMethods),
        }),
    ...(registration.requirePasskey === undefined
      ? {}
      : { require_passkey: registration.requirePasskey }),
    ...(registration.accountAudience === undefined
      ? {}
      : { account_audience: registration.accountAudience }),
    ...(registration.sessionCap === undefined
      ? {}
      : { session_cap: registration.sessionCap }),
    ...(registration.policyVersion === undefined
      ? {}
      : { policy_version: registration.policyVersion }),
    ...(registration.policy.unboundAbsoluteLifetimeMs === undefined
      ? {}
      : {
          unbound_absolute_lifetime_ms:
            registration.policy.unboundAbsoluteLifetimeMs,
        }),
    ...(registration.policy.unboundIdleLifetimeMs === undefined
      ? {}
      : {
          unbound_idle_lifetime_ms: registration.policy.unboundIdleLifetimeMs,
        }),
  };
}
