import type {
  ApiClient,
  NativeAttempt,
  NativeAttemptResult,
  NativeMethods,
  NativeProviderMethod,
} from '@app/sdk';
import { PortAbortController } from '../runtime/abort-controller';
import type { AuthRuntime } from '../runtime/runtime';
import type { AbortSignalPort, SignInOutcome } from '../types/auth';
import type {
  BrowserSignInOptions,
  NativeSignInAction,
  NativeSignInOutcome,
} from '../types/native-sign-in';
import { constantTimeEqual } from '../storage/persistence';

type NativeActionResult =
  | { kind: 'server'; result: NativeAttemptResult }
  | { kind: 'outcome'; outcome: NativeSignInOutcome };

interface NativeActionContext {
  runtime: AuthRuntime;
  client: ApiClient<AbortSignalPort>;
  methods: () => Promise<NativeMethods>;
  cancel: () => Promise<NativeSignInOutcome>;
  browserSignIn: (options: BrowserSignInOptions) => Promise<SignInOutcome>;
}

export async function performNativeAction(
  context: NativeActionContext,
  action: Exclude<NativeSignInAction, { kind: 'start' }>,
  controller: PortAbortController,
): Promise<NativeActionResult> {
  const { runtime, client } = context;
  const native = runtime.record?.nativeAttempt;
  if (!native) return outcome({ kind: 'signedOut' });
  const attempt: NativeAttempt = { id: native.id, secret: native.secret };
  const options = { signal: controller.signal };
  switch (action.kind) {
    case 'password':
      return server(
        await client.nativeAuth.password(
          attempt,
          { email: action.email, password: action.password },
          options,
        ),
      );
    case 'provider':
      return performProvider(context, action, controller, attempt);
    case 'passkey':
      return performPasskey(context, controller, attempt);
    case 'secondFactor':
      return server(await client.nativeAuth.secondFactor(attempt, action.input, options));
    case 'requestEmailLink':
      return server(await client.nativeAuth.requestEmailLink(attempt, action.email, options));
    case 'verifyEmailLink':
      return server(
        await client.nativeAuth.verifyEmailLink(
          attempt,
          { token: action.token, state: action.state },
          options,
        ),
      );
    case 'register':
      return server(await client.nativeAuth.register(attempt, action.email, options));
    case 'activate':
      return server(await client.nativeAuth.activate(attempt, action.input, options));
    case 'requestRecovery':
      return server(await client.nativeAuth.requestRecovery(attempt, action.email, options));
    case 'confirmRecovery':
      return server(await client.nativeAuth.confirmRecovery(attempt, action.input, options));
    case 'consent':
      return server(await client.nativeAuth.consent(attempt, options));
  }
}

async function performProvider(
  context: NativeActionContext,
  action: Extract<NativeSignInAction, { kind: 'provider' }>,
  controller: PortAbortController,
  attempt: NativeAttempt,
): Promise<NativeActionResult> {
  const methods = await context.methods();
  const method = methods.providers.find((candidate) => candidate.id === action.providerId);
  if (!method || !methods.nativeEnabled) return outcome({ kind: 'unavailable' });
  if (method.mode === 'system') {
    const cancelled = await context.cancel();
    if (cancelled.kind !== 'cancelled') return outcome(cancelled);
    const result = await context.browserSignIn({
      providerId: action.providerId,
      locale: action.locale,
    });
    return outcome(mapBrowserResult(result));
  }
  const port = context.runtime.dependencies.providerSignIn;
  if (!port || !(await safeAvailable(() => port.available(method))))
    return outcome({ kind: 'unavailable' });
  const native = context.runtime.record?.nativeAttempt;
  const transaction = context.runtime.record?.transaction;
  if (!native || !transaction) return outcome({ kind: 'signedOut' });
  const prompt = await port.authenticate(
    { method, nonceDigest: native.nonceDigest, state: transaction.state },
    controller.signal,
  );
  if (prompt.kind !== 'success') return outcome(promptOutcome(prompt.kind));
  if (!credentialMatches(method, prompt.value, native.nonceDigest))
    return outcome({ kind: 'apiFailure' });
  return server(
    await context.client.nativeAuth.provider(attempt, prompt.value, {
      signal: controller.signal,
    }),
  );
}

async function performPasskey(
  context: NativeActionContext,
  controller: PortAbortController,
  attempt: NativeAttempt,
): Promise<NativeActionResult> {
  const port = context.runtime.dependencies.passkeys;
  if (!port || !(await safeAvailable(() => port.available())))
    return outcome({ kind: 'unavailable' });
  const options = await context.client.nativeAuth.passkeyOptions(attempt, {
    signal: controller.signal,
  });
  const prompt = await port.authenticate(options, controller.signal);
  if (prompt.kind !== 'success') return outcome(promptOutcome(prompt.kind));
  const isSecondFactor = context.runtime.snapshot.nativeAttempt?.stage === 'secondFactorRequired';
  return server(
    isSecondFactor
      ? await context.client.nativeAuth.secondFactor(
          attempt,
          { passkeyResponse: prompt.value },
          { signal: controller.signal },
        )
      : await context.client.nativeAuth.passkeyVerify(attempt, prompt.value, {
          signal: controller.signal,
        }),
  );
}

function credentialMatches(
  method: NativeProviderMethod,
  credential: Parameters<ApiClient<AbortSignalPort>['nativeAuth']['provider']>[1],
  expectedNonce: string,
): boolean {
  if (method.mode === 'googleIdentityToken')
    return (
      credential.kind === 'googleIdentityToken' &&
      constantTimeEqual(credential.nonceDigest, expectedNonce)
    );
  if (method.mode === 'appleIdentityTokenAndCode')
    return (
      credential.kind === 'appleIdentityTokenAndCode' &&
      constantTimeEqual(credential.nonceDigest, expectedNonce)
    );
  if (method.mode === 'facebook')
    return (
      credential.kind === 'facebookAccessToken' ||
      (credential.kind === 'facebookLimitedToken' &&
        constantTimeEqual(credential.nonceDigest, expectedNonce))
    );
  return false;
}

function promptOutcome(kind: string): NativeSignInOutcome {
  if (kind === 'cancelled') return { kind: 'cancelled' };
  return kind === 'unavailable' ? { kind: 'unavailable' } : { kind: 'apiFailure' };
}

function mapBrowserResult(result: SignInOutcome): NativeSignInOutcome {
  if (result.kind === 'signedIn') return result;
  if (result.kind === 'cancelled' || result.kind === 'dismissed') return { kind: 'cancelled' };
  if (result.kind === 'disposed') return result;
  if (result.kind === 'storageFailure') return { kind: 'storageFailure' };
  if (result.kind === 'transportFailure') return { kind: 'transportFailure' };
  return { kind: 'apiFailure' };
}

async function safeAvailable(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

function outcome(value: NativeSignInOutcome): NativeActionResult {
  return { kind: 'outcome', outcome: value };
}

function server(result: NativeAttemptResult): NativeActionResult {
  return { kind: 'server', result };
}
