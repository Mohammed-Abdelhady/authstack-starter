import { ApiError, type ApiClient, type PasskeyAttestation } from '@app/sdk';
import { createNativeProofAction } from './native-proof';
import { PASSKEY_REAUTH_CODE, PASSKEY_REGISTER_OUTCOME } from '../constants/passkeys';
import { PortAbortController } from '../runtime/abort-controller';
import type { AbortSignalPort, Unsubscribe } from '../types/auth';
import type { PasskeyActions, PasskeyRegisterOutcome } from '../types/passkey-actions';
import type { NativeRegistrationResult, PasskeyPort } from '../types/passkey-port';

/** The engine's session epoch: it moves on sign-out, a new sign-in and disposal. */
export interface PasskeySession {
  readonly epoch: number;
  isEpochCurrent(epoch: number): boolean;
  onEpochChange(listener: () => void): Unsubscribe;
}

export interface PasskeyActionDependencies {
  /** The engine's bearer client: every call goes out on the signed-in session. */
  client: ApiClient<AbortSignalPort>;
  port: PasskeyPort | undefined;
  session: PasskeySession;
}

type Registration = NativeRegistrationResult<PasskeyAttestation>;

const OUTCOME = PASSKEY_REGISTER_OUTCOME;
const PROMPT_FAILED: Registration = { kind: 'failed', reason: 'sdk' };
/**
 * The session the registration started on has ended or been replaced. As the
 * native sign-in controller treats it, the person is signed out of that
 * session: nothing more is sent on it.
 */
const SESSION_CHANGED: PasskeyRegisterOutcome = { kind: OUTCOME.SIGN_IN_AGAIN };

/** A port call that throws, synchronously or not, answers `fallback`. */
function guarded<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  return Promise.resolve()
    .then(call)
    .catch(() => fallback);
}

/** A refused server call: a stale sign-in asks to sign in again, anything else failed. */
function refusal(error: unknown): PasskeyRegisterOutcome {
  return error instanceof ApiError && error.code === PASSKEY_REAUTH_CODE
    ? { kind: OUTCOME.SIGN_IN_AGAIN }
    : { kind: OUTCOME.FAILED };
}

function promptOutcome(result: Exclude<Registration, { kind: 'success' }>): PasskeyRegisterOutcome {
  switch (result.kind) {
    case 'cancelled':
      return { kind: OUTCOME.CANCELLED };
    case 'unavailable':
      return { kind: OUTCOME.NOT_SUPPORTED };
    case 'excluded':
      return { kind: OUTCOME.ALREADY_REGISTERED };
    case 'failed':
      return { kind: OUTCOME.FAILED };
  }
}

export function createPasskeyActions({
  client,
  port,
  session,
}: PasskeyActionDependencies): PasskeyActions {
  let inFlight: Promise<PasskeyRegisterOutcome> | undefined;

  const available = async (): Promise<boolean> =>
    port?.register !== undefined && guarded(() => port.available(), false);

  /** The prompt, ended early when the session moves on. */
  const prompt = async (
    register: NonNullable<PasskeyPort['register']>,
    options: Parameters<NonNullable<PasskeyPort['register']>>[0],
  ): Promise<Registration> => {
    const controller = new PortAbortController();
    const stopFollowing = session.onEpochChange(() => controller.abort());
    try {
      return await guarded(() => register(options, controller.signal), PROMPT_FAILED);
    } finally {
      stopFollowing();
    }
  };

  const run = async (name: string | undefined): Promise<PasskeyRegisterOutcome> => {
    const epoch = session.epoch;
    const current = () => session.isEpochCurrent(epoch);
    const register = port?.register?.bind(port);
    // A device that cannot make a passkey is told so before the server is asked.
    if (register === undefined || !(await available())) return { kind: OUTCOME.NOT_SUPPORTED };
    if (!current()) return SESSION_CHANGED;

    const asked = await client.passkeys.nativeRegistrationOptions().then(
      (options) => ({ options }),
      (error: unknown) => ({ refused: refusal(error) }),
    );
    if ('refused' in asked) return asked.refused;
    if (!current()) return SESSION_CHANGED;

    const result = await prompt(register, asked.options);
    // A late attestation never goes out on a session other than its own.
    if (!current()) return SESSION_CHANGED;
    if (result.kind !== 'success') return promptOutcome(result);

    try {
      const passkey = await client.passkeys.nativeRegistrationVerify({
        response: result.value,
        ...(name === undefined ? {} : { name }),
      });
      return { kind: OUTCOME.CREATED, passkey };
    } catch (error) {
      return refusal(error);
    }
  };

  return {
    prove: createNativeProofAction({ client, port, session }),
    available,
    register(name) {
      if (inFlight) return inFlight;
      const pending = run(name).finally(() => {
        if (inFlight === pending) inFlight = undefined;
      });
      inFlight = pending;
      return pending;
    },
    list: () => client.passkeys.list(),
    rename: (passkeyId, name) => client.passkeys.rename(passkeyId, name),
    remove: (passkeyId) => client.passkeys.remove(passkeyId),
  };
}
