import { describe, expect, it } from 'vitest';
import {
  createApiClient,
  type PasskeyCreationOptions,
  type Transport,
  type TransportRequest,
} from '@app/sdk';
import { createPasskeySignInPort } from '../src/ports/passkey-sign-in';
import type { NativePasskeyCreationRequest } from '../src/types/sign-in-modules';
import { TestAbort } from './support/abort';
import {
  createNativeSignInFixture,
  createNativeSignInSettings,
} from './support/native-sign-in-modules';

/** Options as the SDK parsed them from the server, for the configured relying party. */
const OPTIONS: PasskeyCreationOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'example.test', name: 'Example' },
  user: { id: 'dXNlci0x', name: 'person@example.test', displayName: 'Person' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [{ type: 'public-key', id: 'b2xkLWtleQ', transports: ['internal', 'cable'] }],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  attestation: 'none',
};

/** The same options as the module must receive them, written out by hand. */
const MODULE_REQUEST: NativePasskeyCreationRequest = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'example.test', name: 'Example' },
  user: { id: 'dXNlci0x', name: 'person@example.test', displayName: 'Person' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [{ type: 'public-key', id: 'b2xkLWtleQ', transports: ['internal'] }],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  attestation: 'none',
};

const SUMMARY = {
  id: 'passkey-1',
  name: 'Phone',
  backedUp: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
};

/** The port over a module whose `create` throws or answers what the case says. */
function portCreating(create?: (request: NativePasskeyCreationRequest) => Promise<unknown>) {
  const fixture = createNativeSignInFixture('android');
  const module = fixture.modules.passkeys;
  if (!module) throw new Error('Missing passkey SDK fixture');
  if (create) module.create = create;
  return createPasskeySignInPort('android', module, createNativeSignInSettings());
}

describe('passkey registration prompt', () => {
  it('hands the module the server options and the verify route exactly what the module made', async () => {
    const asked: NativePasskeyCreationRequest[] = [];
    const port = portCreating(async (request) => {
      asked.push(request);
      // What react-native-passkeys 0.4.2 resolves with, its public key reader included.
      return {
        id: 'bmV3LWtleQ',
        rawId: 'bmV3LWtleQ',
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: 'e30',
          attestationObject: 'o2NmbXQ',
          transports: ['internal', 'hybrid'],
          publicKeyAlgorithm: -7,
          getPublicKey: () => 'cHVibGlj',
        },
      };
    });
    const sent: TransportRequest[] = [];
    const server: Transport = {
      request: async (request) => {
        sent.push(request);
        return { status: 200, body: { success: true, data: SUMMARY } };
      },
    };

    const made = await port.register?.(OPTIONS, new TestAbort().signal);
    if (made?.kind !== 'success') throw new Error(`the prompt answered ${made?.kind}`);
    await createApiClient(server).passkeys.nativeRegistrationVerify({
      response: made.value,
      name: 'Phone',
    });

    expect(asked).toEqual([MODULE_REQUEST]);
    expect(sent.map((request) => [request.method, request.path, request.body])).toEqual([
      [
        'POST',
        '/api/auth/native/passkeys/register/verify',
        {
          response: {
            id: 'bmV3LWtleQ',
            rawId: 'bmV3LWtleQ',
            type: 'public-key',
            response: {
              clientDataJSON: 'e30',
              attestationObject: 'o2NmbXQ',
              transports: ['internal', 'hybrid'],
            },
            authenticatorAttachment: 'platform',
            clientExtensionResults: { credProps: { rk: true } },
          },
          name: 'Phone',
        },
      ],
    ]);
  });

  it('reports an authenticator that already holds an excluded passkey apart from a failure', async () => {
    const excluded = portCreating(async () => {
      throw new Error('DomError: InvalidStateError - credential already exists');
    });
    const broken = portCreating(async () => {
      throw new Error('UnknownError');
    });

    expect(await excluded.register?.(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'excluded',
    });
    expect(await broken.register?.(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'failed',
      reason: 'sdk',
    });
  });

  it('reads the module`s cancel as cancelled, not as an excluded passkey', async () => {
    const port = portCreating(async () => {
      throw new Error('UserCancelled');
    });

    expect(await port.register?.(OPTIONS, new TestAbort().signal)).toEqual({ kind: 'cancelled' });
  });

  it.each([
    ['Android', { code: 'Passkey Create', message: 'NotSupported' }],
    ['iOS', { code: 'ERR_NOT_SUPPORTED', message: 'Passkeys are not supported' }],
    ['the web', { name: 'NotSupportedError', message: 'Passkey are not supported' }],
  ])('reads %s refusing to create as a device without passkeys', async (_platform, refusal) => {
    const port = portCreating(() => Promise.reject(refusal));

    expect(await port.register?.(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'unavailable',
    });
  });

  it('offers no registration over a module that cannot create, and still signs in', async () => {
    const port = portCreating();

    expect(port.register).toBeUndefined();
    expect(await port.available()).toBe(true);
  });
});
