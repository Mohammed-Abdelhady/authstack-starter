export interface SessionLimitApplication {
  readonly platform: string;
  readonly sessionCap?: number;
  readonly policy: {
    readonly absoluteLifetimeMs: number;
    readonly idleLifetimeMs: number;
    readonly unboundAbsoluteLifetimeMs?: number;
    readonly unboundIdleLifetimeMs?: number;
  };
}

export interface SessionLimits {
  readonly absoluteLifetimeMs: number;
  readonly idleLifetimeMs: number;
  readonly initialIdleLifetimeMs: number;
}
