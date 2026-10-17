import { PortAbortController } from '../runtime/abort-controller';
import type { PasskeyActionDependencies } from './passkey-actions';

export function createNativeProofAction({ client, port, session }: PasskeyActionDependencies) {
  let inFlight: Promise<boolean> | undefined;
  const run = async (): Promise<boolean> => {
    const epoch = session.epoch;
    const current = () => session.isEpochCurrent(epoch);
    if (!port || !(await port.available()) || !current()) return false;
    const controller = new PortAbortController();
    let stopFollowing = () => {};
    const canceled = new Promise<false>((resolve) => {
      stopFollowing = session.onEpochChange(() => {
        controller.abort();
        resolve(false);
      });
    });
    const prove = async () => {
      const options = await client.passkeys.nativeProofOptions({ signal: controller.signal });
      if (!current()) return false;
      const assertion = await port.authenticate(options, controller.signal);
      if (!current() || assertion.kind !== 'success') return false;
      await client.passkeys.nativeProofVerify(assertion.value, { signal: controller.signal });
      return current();
    };
    try {
      return await Promise.race([prove(), canceled]);
    } catch {
      return false;
    } finally {
      stopFollowing();
    }
  };
  return (): Promise<boolean> => {
    if (inFlight) return inFlight;
    const pending = run()
      .catch(() => false)
      .finally(() => {
        if (inFlight === pending) inFlight = undefined;
      });
    inFlight = pending;
    return pending;
  };
}
