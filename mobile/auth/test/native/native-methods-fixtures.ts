import type { NativeMethods } from '@app/sdk';

export const METHODS_DEADLINE_MS = 15_000;
export const METHODS: NativeMethods = {
  nativeEnabled: true,
  methods: {
    password: true,
    magicLink: false,
    emailCode: false,
    passkeys: true,
    twoFactor: false,
    oauth: [],
  },
  capabilities: {
    password: true,
    emailLink: false,
    passkeys: true,
    registration: true,
    recovery: true,
  },
  providers: [],
};
export const GOOGLE_METHODS: NativeMethods = {
  ...METHODS,
  methods: { ...METHODS.methods, oauth: [{ id: 'google', displayName: 'Google' }] },
  providers: [
    {
      id: 'google',
      displayName: 'Google',
      mode: 'googleIdentityToken',
      sdk: { kind: 'google', webClientId: 'web-client' },
    },
  ],
};

export async function drainMethods(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}
