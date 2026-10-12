import { ErrorCode } from '../../../common/enums/error-code.enum';
import { PASSKEY_CHALLENGE_COOKIE } from '../constants/passkeys.constants';
import { PasskeyRegistrationReauth } from './passkey-registration-reauth.service';
import {
  PasskeyRegistrationService,
  SignedInRequest,
} from './passkey-registration.service';
import { MongoPasskeyAccounts } from '../persistence/mongo/mongo-passkey-accounts';
import { MongoPasskeyStore } from '../persistence/mongo/mongo-passkey.store';
import { PasskeyChallengeService } from './passkey-challenge.service';
import { WebAuthnAdapter } from './webauthn.adapter';
import {
  createModelMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import {
  CREDENTIAL_BODY,
  CREDENTIAL_ID,
  createChallengeService,
  createMockPasskey,
  createMockRequest,
  createMockResponse,
  createPasskeyConfig,
  OTHER_USER_ID,
  ORIGIN,
  RP_ID,
  USER_ID,
} from '../persistence/mongo/passkeys.harness-spec';

/**
 * The library boundary is mocked. A registration that would satisfy the real
 * verifier needs an attestation signed by an authenticator, which cannot be
 * produced here; what this checks is the code around it, which is the part
 * this repository owns.
 */

const ATTESTATION = {
  credentialId: CREDENTIAL_ID,
  publicKey: Buffer.from([9, 9, 9]),
  counter: 0,
  transports: ['internal'],
  deviceType: 'multiDevice',
  backedUp: true,
};

const SESSION = { id: 'session-one', createdAt: new Date(0) };

/** A request on the session the challenge is issued to. */
function signedIn(cookies: Record<string, string>): SignedInRequest {
  return Object.assign(createMockRequest(cookies), { session: SESSION });
}

interface Harness {
  service: PasskeyRegistrationService;
  adapter: {
    createRegistrationOptions: jest.Mock;
    verifyAttestation: jest.Mock;
  };
  passkeyModel: {
    find: jest.Mock;
    exists: jest.Mock;
    create: jest.Mock;
  };
  challenges: PasskeyChallengeService;
}

function createHarness(options: { alreadyRegistered?: boolean } = {}): Harness {
  const existing = [createMockPasskey()];

  const passkeyModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(existing),
    }),
    exists: jest.fn().mockResolvedValue(options.alreadyRegistered ?? false),
    create: jest
      .fn()
      .mockImplementation((document: Record<string, unknown>) =>
        createMockPasskey({ name: document.name as string }),
      ),
  };

  const userModel = {
    findById: jest.fn().mockResolvedValue({
      _id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      isDeleted: false,
    }),
  };

  const adapter = {
    createRegistrationOptions: jest
      .fn()
      .mockResolvedValue({ challenge: 'challenge-value' }),
    verifyAttestation: jest.fn().mockResolvedValue(ATTESTATION),
  };

  const challenges = createChallengeService();

  return {
    service: new PasskeyRegistrationService(
      new MongoPasskeyStore(
        createModelMock<ConstructorParameters<typeof MongoPasskeyStore>[0]>(
          passkeyModel,
        ),
      ),
      new MongoPasskeyAccounts(
        createModelMock<ConstructorParameters<typeof MongoPasskeyAccounts>[0]>(
          userModel,
        ),
      ),
      partialMock<WebAuthnAdapter>(adapter),
      createPasskeyConfig(),
      challenges,
      // The proof asked before a passkey is added has its own cases.
      partialMock<PasskeyRegistrationReauth>({
        assertMayAddPasskey: () => Promise.resolve(),
      }),
    ),
    adapter,
    passkeyModel,
    challenges,
  };
}

describe('PasskeyRegistrationService', () => {
  describe('createOptions', () => {
    it('should leave the challenge in a cookie and exclude known credentials', async () => {
      const harness = createHarness();
      const { response, cookies } = createMockResponse();

      const result = await harness.service.createOptions(
        USER_ID.toString(),
        {},
        signedIn({}),
        response,
      );

      expect(result.data.challenge).toBe('challenge-value');
      expect(cookies[PASSKEY_CHALLENGE_COOKIE]).toBeDefined();

      const passed = harness.adapter.createRegistrationOptions.mock
        .calls[0][0] as Record<string, unknown>;
      expect(passed.rpId).toBe(RP_ID);
      expect(passed.excludeCredentials).toEqual([
        { id: CREDENTIAL_ID, transports: ['internal'] },
      ]);
    });
  });

  describe('verify', () => {
    async function verifyWith(harness: Harness, userId: string) {
      const issued = createMockResponse();
      await harness.challenges.issue(
        issued.response,
        'register',
        'challenge-value',
        USER_ID.toString(),
        SESSION.id,
      );

      const request = signedIn({
        [PASSKEY_CHALLENGE_COOKIE]: issued.cookies[PASSKEY_CHALLENGE_COOKIE],
      });
      const verifying = createMockResponse();

      return {
        verifying,
        result: harness.service.verify(
          userId,
          { response: CREDENTIAL_BODY, name: 'My key' },
          request,
          verifying.response,
        ),
      };
    }

    it('should store the credential and clear the challenge', async () => {
      const harness = createHarness();
      const { result, verifying } = await verifyWith(
        harness,
        USER_ID.toString(),
      );

      const response = await result;

      expect(response.data.name).toBe('My key');
      expect(verifying.cleared).toEqual([PASSKEY_CHALLENGE_COOKIE]);

      const stored = harness.passkeyModel.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(stored.credentialId).toBe(CREDENTIAL_ID);
      expect(stored.counter).toBe(0);
      expect(stored.backedUp).toBe(true);

      const expected = harness.adapter.verifyAttestation.mock
        .calls[0][1] as Record<string, unknown>;
      expect(expected).toEqual({
        challenge: 'challenge-value',
        origin: ORIGIN,
        rpId: RP_ID,
      });
    });

    it('should refuse a challenge issued to another account', async () => {
      const harness = createHarness();
      const { result } = await verifyWith(harness, OTHER_USER_ID.toString());

      await expect(result).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_CHALLENGE_INVALID,
        status: 401,
      });
      expect(harness.passkeyModel.create).not.toHaveBeenCalled();
    });

    it('should refuse an attestation that does not verify', async () => {
      const harness = createHarness();
      harness.adapter.verifyAttestation.mockResolvedValue(null);

      const { result } = await verifyWith(harness, USER_ID.toString());

      await expect(result).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
        status: 401,
      });
      expect(harness.passkeyModel.create).not.toHaveBeenCalled();
    });

    it('should refuse a credential that is already registered', async () => {
      const harness = createHarness({ alreadyRegistered: true });
      const { result } = await verifyWith(harness, USER_ID.toString());

      await expect(result).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
      });
      expect(harness.passkeyModel.create).not.toHaveBeenCalled();
    });

    it('should refuse a verify with no challenge cookie', async () => {
      const harness = createHarness();
      const { response } = createMockResponse();

      await expect(
        harness.service.verify(
          USER_ID.toString(),
          { response: CREDENTIAL_BODY },
          signedIn({}),
          response,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
    });
  });
});
