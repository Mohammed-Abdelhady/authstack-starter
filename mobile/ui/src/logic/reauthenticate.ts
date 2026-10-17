import type { EnginePort } from '../types';

export function reauthenticate(engine: EnginePort): Promise<boolean> {
  if (engine.snapshot.status !== 'signedIn') return Promise.resolve(false);
  // feature:passkeys:start
  if (engine.passkeys?.prove) return engine.passkeys.prove();
  // feature:passkeys:end
  return Promise.resolve(false);
}
