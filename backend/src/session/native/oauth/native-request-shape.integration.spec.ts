import request from 'supertest';
import {
  NATIVE_DPOP_REVOKE_PATH,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import {
  issueNativeGrant,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  nativeHttpServer,
  NativeOauthHarness,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';

const INVALID_REQUEST = { error: 'invalid_request' };

const NON_STRING_VALUES: [string, unknown][] = [
  ['a number', 7],
  ['an array', ['x']],
  ['an object', { nested: 'x' }],
  ['null', null],
];

const CODE_GRANT = {
  grant_type: 'authorization_code',
  code: 'unknown-code',
  redirect_uri: NATIVE_REDIRECT,
  client_id: NATIVE_CLIENT_ID,
  code_verifier: 'v'.repeat(43),
};

const REFRESH_GRANT = {
  grant_type: 'refresh_token',
  refresh_token: 'unknown-refresh-token',
  client_id: NATIVE_CLIENT_ID,
};

const REVOCATION = { token: 'unknown-token', client_id: NATIVE_CLIENT_ID };

function cases(fields: string[]): [string, string, unknown][] {
  return fields.flatMap((field) =>
    NON_STRING_VALUES.map(([label, value]): [string, string, unknown] => [
      field,
      label,
      value,
    ]),
  );
}

describe('native token and revoke request shape', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_request_shape');
    await ctx.harness.app.listen(0, '127.0.0.1');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  function post(path: string) {
    return request(nativeHttpServer(ctx.harness.app)).post(path);
  }

  it.each(
    cases(['grant_type', 'code', 'code_verifier', 'client_id', 'redirect_uri']),
  )('refuses a code exchange whose %s is %s', async (field, _label, value) => {
    const response = await post(NATIVE_DPOP_TOKEN_PATH).send({
      ...CODE_GRANT,
      [field]: value,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_REQUEST);
  });

  it.each(cases(['grant_type', 'refresh_token', 'client_id']))(
    'refuses a refresh whose %s is %s',
    async (field, _label, value) => {
      const response = await post(NATIVE_DPOP_TOKEN_PATH).send({
        ...REFRESH_GRANT,
        [field]: value,
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual(INVALID_REQUEST);
    },
  );

  it.each(cases(['token', 'client_id']))(
    'refuses a revocation whose %s is %s',
    async (field, _label, value) => {
      const response = await post(NATIVE_DPOP_REVOKE_PATH).send({
        ...REVOCATION,
        [field]: value,
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual(INVALID_REQUEST);
    },
  );

  it.each([
    ['code', CODE_GRANT],
    ['code_verifier', CODE_GRANT],
    ['client_id', CODE_GRANT],
    ['redirect_uri', CODE_GRANT],
    ['refresh_token', REFRESH_GRANT],
    ['client_id', REFRESH_GRANT],
  ])('refuses an empty %s on the token route', async (field, grant) => {
    const response = await post(NATIVE_DPOP_TOKEN_PATH).send({
      ...grant,
      [field]: '',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_REQUEST);
  });

  it('answers an empty grant type as an unsupported grant', async () => {
    const response = await post(NATIVE_DPOP_TOKEN_PATH).send({
      ...CODE_GRANT,
      grant_type: '',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'unsupported_grant_type' });
  });

  it('refuses an empty token on the revoke route', async () => {
    const response = await post(NATIVE_DPOP_REVOKE_PATH).send({
      ...REVOCATION,
      token: '',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_REQUEST);
  });

  it.each([
    ['token', NATIVE_DPOP_TOKEN_PATH],
    ['revoke', NATIVE_DPOP_REVOKE_PATH],
  ])('refuses a %s request with no body', async (_route, path) => {
    const response = await post(path);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_REQUEST);
  });

  it.each([
    ['token', NATIVE_DPOP_TOKEN_PATH],
    ['revoke', NATIVE_DPOP_REVOKE_PATH],
  ])('refuses a %s request whose body is a list', async (_route, path) => {
    const response = await post(path).send([CODE_GRANT]);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_REQUEST);
  });

  it('keeps the session when a revocation names a non-string client', async () => {
    const granted = await issueNativeGrant(ctx);

    const response = await post(NATIVE_DPOP_REVOKE_PATH).send({
      token: granted.refreshToken,
      client_id: 7,
    });

    const session = await ctx.harness.sessions
      .findOne({ clientId: NATIVE_CLIENT_ID })
      .orFail();
    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_REQUEST);
    expect(session.isValid).toBe(true);
  });

  it('still revokes a well-formed request', async () => {
    const granted = await issueNativeGrant(ctx);

    const response = await post(NATIVE_DPOP_REVOKE_PATH).send({
      token: granted.refreshToken,
      client_id: NATIVE_CLIENT_ID,
    });

    const session = await ctx.harness.sessions
      .findOne({ clientId: NATIVE_CLIENT_ID })
      .orFail();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({});
    expect(session.isValid).toBe(false);
  });

  it('does not report a fault outside the transaction as an outage', async () => {
    const fault = new TypeError('fault outside the transaction');
    const spy = jest
      .spyOn(ctx.harness.clock, 'now')
      .mockImplementationOnce(() => {
        throw fault;
      });

    try {
      await expect(
        ctx.tokens.grant(CODE_GRANT, NATIVE_META, 'any-proof'),
      ).rejects.toBe(fault);
    } finally {
      spy.mockRestore();
    }
  });
});
