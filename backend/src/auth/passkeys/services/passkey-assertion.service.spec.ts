import { ErrorCode } from '../../../common/enums/error-code.enum';
import { PASSKEY_CHALLENGE_COOKIE } from '../constants/passkeys.constants';
import { PasskeyAssertionService } from './passkey-assertion.service';
import { MongoPasskeyStore } from '../persistence/mongo/mongo-passkey.store';
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
  MockPasskey,
  RP_ID,
} from '../persistence/mongo/passkeys.harness-spec';

/** The signature check itself is the library's; everything around it is here. */

interface Harness {
  service: PasskeyAssertionService;
  adapter: {
    createAuthenticationOptions: jest.Mock;
    verifyAssertion: jest.Mock;
  };
  passkey: MockPasskey;
  request: ReturnType<typeof createMockRequest>;
}

async function createHarness(
  passkey: MockPasskey | null = createMockPasskey(),
  newCounter = 5,
  userVerified = true,
): Promise<Harness> {
  const passkeyModel = {
    findOne: jest.fn().mockResolvedValue(passkey),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };

  const adapter = {
    createAuthenticationOptions: jest
      .fn()
      .mockResolvedValue({ challenge: 'challenge-value' }),
    verifyAssertion: jest.fn().mockResolvedValue({ newCounter, userVerified }),
  };

  const challenges = createChallengeService();
  const issued = createMockResponse();
  await challenges.issue(issued.response, 'login', 'challenge-value');

  return {
    service: new PasskeyAssertionService(
      new MongoPasskeyStore(
        createModelMock<ConstructorParameters<typeof MongoPasskeyStore>[0]>(
          passkeyModel,
        ),
      ),
      partialMock<WebAuthnAdapter>(adapter),
      createPasskeyConfig(),
      challenges,
    ),
    adapter,
    passkey: passkey ?? createMockPasskey(),
    request: createMockRequest({
      [PASSKEY_CHALLENGE_COOKIE]: issued.cookies[PASSKEY_CHALLENGE_COOKIE],
    }),
  };
}

describe('PasskeyAssertionService', () => {
  describe('createOptions', () => {
    it('should ask for a discoverable credential and leave a challenge cookie', async () => {
      const harness = await createHarness();
      const { response, cookies } = createMockResponse();

      const options = await harness.service.createOptions(response);

      expect(options.challenge).toBe('challenge-value');
      expect(cookies[PASSKEY_CHALLENGE_COOKIE]).toBeDefined();
      expect(harness.adapter.createAuthenticationOptions).toHaveBeenCalledWith({
        rpId: RP_ID,
        allowCredentials: [],
      });
    });
  });

  describe('verify', () => {
    it('should move the counter forward and stamp the passkey as used', async () => {
      const harness = await createHarness();
      const { response, cleared } = createMockResponse();

      const result = await harness.service.verify(
        CREDENTIAL_BODY,
        harness.request,
        response,
      );

      expect(result.userVerified).toBe(true);
      expect(harness.passkey.counter).toBe(5);
      expect(harness.passkey.lastUsedAt).toEqual(expect.any(Date));
      expect(harness.passkey.save).not.toHaveBeenCalled();
      expect(cleared).toEqual([PASSKEY_CHALLENGE_COOKIE]);
    });

    it('should report a passkey that did not verify the user', async () => {
      const harness = await createHarness(createMockPasskey(), 5, false);
      const { response } = createMockResponse();

      const result = await harness.service.verify(
        CREDENTIAL_BODY,
        harness.request,
        response,
      );

      expect(result.userVerified).toBe(false);
    });

    it('should refuse a counter that repeats, which is how a clone shows up', async () => {
      const harness = await createHarness(createMockPasskey({ counter: 7 }), 7);
      const { response } = createMockResponse();

      await expect(
        harness.service.verify(CREDENTIAL_BODY, harness.request, response),
      ).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_VERIFICATION_FAILED,
        status: 401,
      });
      expect(harness.passkey.save).not.toHaveBeenCalled();
    });

    it('should refuse a counter that goes backwards', async () => {
      const harness = await createHarness(createMockPasskey({ counter: 9 }), 3);
      const { response } = createMockResponse();

      await expect(
        harness.service.verify(CREDENTIAL_BODY, harness.request, response),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_VERIFICATION_FAILED });
    });

    it('should let an authenticator that never counts through', async () => {
      const harness = await createHarness(createMockPasskey({ counter: 0 }), 0);
      const { response } = createMockResponse();

      const result = await harness.service.verify(
        CREDENTIAL_BODY,
        harness.request,
        response,
      );

      expect(result.passkey.counter).toBe(0);
      expect(harness.passkey.save).not.toHaveBeenCalled();
    });

    it('should refuse a credential that is not registered', async () => {
      const harness = await createHarness(null);
      const { response } = createMockResponse();

      await expect(
        harness.service.verify(CREDENTIAL_BODY, harness.request, response),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_VERIFICATION_FAILED });
    });

    it('should refuse an assertion whose signature does not check out', async () => {
      const harness = await createHarness();
      harness.adapter.verifyAssertion.mockResolvedValue(null);
      const { response } = createMockResponse();

      await expect(
        harness.service.verify(CREDENTIAL_BODY, harness.request, response),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_VERIFICATION_FAILED });
    });

    it('should spend the challenge cookie even when the attempt fails', async () => {
      const harness = await createHarness(null);
      const { response, cleared } = createMockResponse();

      await expect(
        harness.service.verify(CREDENTIAL_BODY, harness.request, response),
      ).rejects.toThrow();

      expect(cleared).toEqual([PASSKEY_CHALLENGE_COOKIE]);
    });

    it('should check the assertion against the stored credential', async () => {
      const harness = await createHarness();
      const { response } = createMockResponse();

      await harness.service.verify(CREDENTIAL_BODY, harness.request, response);

      const stored = harness.adapter.verifyAssertion.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(stored.id).toBe(CREDENTIAL_ID);
      expect(stored.counter).toBe(4);
    });

    it('should refuse a sign-in that presents a registration challenge', async () => {
      const harness = await createHarness();
      const challenges = createChallengeService();
      const issued = createMockResponse();
      await challenges.issue(
        issued.response,
        'register',
        'challenge-value',
        'user',
      );
      const { response } = createMockResponse();

      await expect(
        harness.service.verify(
          CREDENTIAL_BODY,
          createMockRequest({
            [PASSKEY_CHALLENGE_COOKIE]:
              issued.cookies[PASSKEY_CHALLENGE_COOKIE],
          }),
          response,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
    });

    it('should refuse a copied challenge that was already consumed', async () => {
      const store = {
        create: jest.fn().mockResolvedValue({}),
        findOneAndDelete: jest
          .fn()
          .mockResolvedValueOnce({ _id: 'stored' })
          .mockResolvedValueOnce(null),
      };
      const challenges = createChallengeService(undefined, store);
      const issued = createMockResponse();
      await challenges.issue(issued.response, 'login', 'challenge-value');

      const passkey = createMockPasskey();
      const passkeyModel = {
        findOne: jest.fn().mockResolvedValue(passkey),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      const adapter = {
        createAuthenticationOptions: jest.fn(),
        verifyAssertion: jest
          .fn()
          .mockResolvedValue({ newCounter: 5, userVerified: true }),
      };
      const service = new PasskeyAssertionService(
        new MongoPasskeyStore(
          createModelMock<ConstructorParameters<typeof MongoPasskeyStore>[0]>(
            passkeyModel,
          ),
        ),
        partialMock<WebAuthnAdapter>(adapter),
        createPasskeyConfig(),
        challenges,
      );
      const request = createMockRequest({
        [PASSKEY_CHALLENGE_COOKIE]: issued.cookies[PASSKEY_CHALLENGE_COOKIE],
      });

      await service.verify(
        CREDENTIAL_BODY,
        request,
        createMockResponse().response,
      );
      await expect(
        service.verify(CREDENTIAL_BODY, request, createMockResponse().response),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
    });

    it('should refuse a zero-counter replay after the challenge is spent', async () => {
      const store = {
        create: jest.fn().mockResolvedValue({}),
        findOneAndDelete: jest
          .fn()
          .mockResolvedValueOnce({ _id: 'stored' })
          .mockResolvedValueOnce(null),
      };
      const challenges = createChallengeService(undefined, store);
      const issued = createMockResponse();
      await challenges.issue(issued.response, 'login', 'challenge-value');
      const passkey = createMockPasskey({ counter: 0 });
      const passkeyModel = {
        findOne: jest.fn().mockResolvedValue(passkey),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      const adapter = {
        createAuthenticationOptions: jest.fn(),
        verifyAssertion: jest
          .fn()
          .mockResolvedValue({ newCounter: 0, userVerified: true }),
      };
      const service = new PasskeyAssertionService(
        new MongoPasskeyStore(
          createModelMock<ConstructorParameters<typeof MongoPasskeyStore>[0]>(
            passkeyModel,
          ),
        ),
        partialMock<WebAuthnAdapter>(adapter),
        createPasskeyConfig(),
        challenges,
      );
      const request = createMockRequest({
        [PASSKEY_CHALLENGE_COOKIE]: issued.cookies[PASSKEY_CHALLENGE_COOKIE],
      });

      await service.verify(
        CREDENTIAL_BODY,
        request,
        createMockResponse().response,
      );
      await expect(
        service.verify(CREDENTIAL_BODY, request, createMockResponse().response),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
    });
  });
});
