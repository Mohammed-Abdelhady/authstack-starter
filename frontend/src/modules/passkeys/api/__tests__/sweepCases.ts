import { passkeysApi } from '../passkeysApi';
import type { TestStore } from '@/tests/serverRejectionHarness';
import type { MutationCase } from '@/store/api/__tests__/mutationSweepBase';
import { GET_PROFILE, LOGIN_RESPONSE, readProfile } from '@/store/api/__tests__/mutationSweepBase';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '../../utils/webauthn';

const PASSKEY = {
  id: 'passkey-1',
  name: 'MacBook key',
  backedUp: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  lastUsedAt: null,
};

const PASSKEYS_PATH = '/api/auth/passkeys';
const GET_PASSKEYS = `GET ${PASSKEYS_PATH}`;

const readPasskeys = (store: TestStore) =>
  store.dispatch(passkeysApi.endpoints.getPasskeys.initiate());

/** What the suite's own reads answer; merged into the shared runner. */
export const extraReads: Record<string, unknown> = {
  [PASSKEYS_PATH]: { passkeys: [PASSKEY] },
};

const REGISTRATION_RESPONSE: RegistrationResponseJSON = {
  id: 'credential-1',
  rawId: 'credential-1',
  response: { clientDataJSON: 'e30', attestationObject: 'oQ' },
  clientExtensionResults: {},
  type: 'public-key',
};

const AUTHENTICATION_RESPONSE: AuthenticationResponseJSON = {
  id: 'credential-1',
  rawId: 'credential-1',
  response: { clientDataJSON: 'e30', authenticatorData: 'og', signature: 'AA' },
  clientExtensionResults: {},
  type: 'public-key',
};

/** Passkey mutations that do not invalidate on a 4xx. */
export const CONVERTED: MutationCase[] = [
  {
    name: 'registerPasskey',
    reads: [readPasskeys, readProfile],
    write: (store) =>
      store.dispatch(
        passkeysApi.endpoints.registerPasskey.initiate({
          response: REGISTRATION_RESPONSE,
          name: 'Travel key',
        }),
      ),
    accepted: PASSKEY,
    requests: [GET_PASSKEYS, GET_PROFILE, 'POST /api/auth/passkeys/register/verify'],
    refetched: [GET_PASSKEYS, GET_PROFILE],
  },
  {
    name: 'renamePasskey',
    reads: [readPasskeys],
    write: (store) =>
      store.dispatch(
        passkeysApi.endpoints.renamePasskey.initiate({ id: 'passkey-1', name: 'Travel key' }),
      ),
    accepted: PASSKEY,
    requests: [GET_PASSKEYS, 'PATCH /api/auth/passkeys/passkey-1'],
    refetched: [GET_PASSKEYS],
  },
  {
    name: 'deletePasskey',
    reads: [readPasskeys, readProfile],
    write: (store) => store.dispatch(passkeysApi.endpoints.deletePasskey.initiate('passkey-1')),
    accepted: { message: 'Passkey deleted' },
    requests: [GET_PASSKEYS, GET_PROFILE, 'DELETE /api/auth/passkeys/passkey-1'],
    refetched: [GET_PASSKEYS, GET_PROFILE],
  },
  {
    name: 'signInWithPasskey',
    reads: [readProfile],
    write: (store) =>
      store.dispatch(
        passkeysApi.endpoints.signInWithPasskey.initiate({ response: AUTHENTICATION_RESPONSE }),
      ),
    accepted: LOGIN_RESPONSE,
    requests: [GET_PROFILE, 'POST /api/auth/passkeys/login/verify'],
    refetched: [GET_PROFILE],
  },
  {
    name: 'answerTwoFactorWithPasskey',
    reads: [readProfile],
    write: (store) =>
      store.dispatch(
        passkeysApi.endpoints.answerTwoFactorWithPasskey.initiate({
          passkeyResponse: AUTHENTICATION_RESPONSE,
        }),
      ),
    accepted: LOGIN_RESPONSE,
    requests: [GET_PROFILE, 'POST /api/auth/2fa/verify'],
    refetched: [GET_PROFILE],
  },
];

/**
 * Passkey ceremonies that invalidate nothing. They subscribe the reads of the
 * tags the passkey sweeps touch — Passkeys, User — so a mutation that gains
 * either tag makes these rows fail.
 */
export const UNTAGGED: MutationCase[] = [
  {
    name: 'createPasskeyOptions',
    reads: [readPasskeys, readProfile],
    write: (store) => store.dispatch(passkeysApi.endpoints.createPasskeyOptions.initiate({})),
    accepted: {
      rp: { name: 'Example', id: 'example.com' },
      user: { id: 'user-1', name: 'layla@example.com', displayName: 'Layla Haddad' },
      challenge: 'c29tZXRoaW5n',
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    },
    requests: [GET_PASSKEYS, GET_PROFILE, 'POST /api/auth/passkeys/register/options'],
    refetched: [],
  },
  {
    name: 'createPasskeyLoginOptions',
    reads: [readPasskeys, readProfile],
    write: (store) => store.dispatch(passkeysApi.endpoints.createPasskeyLoginOptions.initiate()),
    accepted: { challenge: 'c29tZXRoaW5n', rpId: 'example.com' },
    requests: [GET_PASSKEYS, GET_PROFILE, 'POST /api/auth/passkeys/login/options'],
    refetched: [],
  },
];
