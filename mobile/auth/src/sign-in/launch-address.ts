import { CALLBACK_READ_TIMEOUT_MS, LAUNCH_ADDRESS, PORT_OPERATION } from '../constants';
import { withPortDeadline } from '../runtime/deadlines';
import type { AuthRuntime } from '../runtime/runtime';
import type { LaunchAddressResult, RestoreOutcome } from '../types/auth';

const UNAVAILABLE: LaunchAddressResult = { kind: LAUNCH_ADDRESS.UNAVAILABLE };

/** Ends a restore: hands the launch address to sign-in, then reports where the engine stands. */
export async function finishRestoreWithLaunchAddress(
  runtime: AuthRuntime,
  signIn: { processInitialAddress(address?: string): Promise<void> },
): Promise<RestoreOutcome> {
  const epoch = runtime.epoch;
  const address = await readLaunchAddress(runtime, epoch);
  if (runtime.isEpochCurrent(epoch)) await signIn.processInitialAddress(address);
  return { kind: 'restored', status: runtime.snapshot.status };
}

async function readLaunchAddress(runtime: AuthRuntime, epoch: number): Promise<string | undefined> {
  if (runtime.initialAddressRead) return undefined;
  let result = UNAVAILABLE;
  try {
    result = await withPortDeadline(
      runtime.dependencies.timer,
      CALLBACK_READ_TIMEOUT_MS,
      () => sharedRead(runtime),
      PORT_OPERATION.CALLBACK_INITIAL_ADDRESS,
    );
  } catch {
    // A read past its deadline stays pending, so a later restore can still take its answer.
    result = UNAVAILABLE;
  }
  if (runtime.initialAddressRead || !runtime.isEpochCurrent(epoch)) return undefined;
  // The read stays unmarked, so the next restore asks again.
  if (result.kind === LAUNCH_ADDRESS.UNAVAILABLE) return undefined;
  runtime.initialAddressRead = true;
  runtime.initialAddressPending = undefined;
  return result.kind === LAUNCH_ADDRESS.ADDRESS ? result.address : undefined;
}

function sharedRead(runtime: AuthRuntime): Promise<LaunchAddressResult> {
  if (runtime.initialAddressPending) return runtime.initialAddressPending;
  const pending = askPort(runtime);
  runtime.initialAddressPending = pending;
  void pending.then((result) => {
    if (result.kind === LAUNCH_ADDRESS.UNAVAILABLE && runtime.initialAddressPending === pending)
      runtime.initialAddressPending = undefined;
  });
  return pending;
}

async function askPort(runtime: AuthRuntime): Promise<LaunchAddressResult> {
  try {
    const result = await runtime.dependencies.callbacks.initialAddress();
    if (result.kind === LAUNCH_ADDRESS.ADDRESS || result.kind === LAUNCH_ADDRESS.NONE)
      return result;
  } catch {
    // A failed read is reported like an unavailable one.
  }
  return UNAVAILABLE;
}
