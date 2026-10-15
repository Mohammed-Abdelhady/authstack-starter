import { APPLICATION_PLATFORM } from '../../constants/client-ids';
import { NATIVE_INITIAL_IDLE_MS } from '../../constants/session-policy';
import type {
  SessionLimitApplication,
  SessionLimits,
} from '../../types/session-limits';

export function sessionLimitsFor(
  application: SessionLimitApplication,
  bound: boolean,
): SessionLimits {
  const native = application.platform === APPLICATION_PLATFORM.NATIVE;
  const policy = application.policy;
  const unboundAbsolute = policy.unboundAbsoluteLifetimeMs;
  const unboundIdle = policy.unboundIdleLifetimeMs;
  const configured =
    native && unboundAbsolute !== undefined && unboundIdle !== undefined;
  const absoluteLifetimeMs =
    configured && !bound ? unboundAbsolute : policy.absoluteLifetimeMs;
  const idleLifetimeMs =
    configured && !bound ? unboundIdle : policy.idleLifetimeMs;
  return {
    absoluteLifetimeMs,
    idleLifetimeMs,
    initialIdleLifetimeMs: native
      ? Math.min(NATIVE_INITIAL_IDLE_MS, idleLifetimeMs)
      : idleLifetimeMs,
  };
}
