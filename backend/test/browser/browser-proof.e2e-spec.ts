import request, { type Response as SupertestResponse } from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SessionModule } from '../../src/session/session.module';
import {
  BROWSER_PROOF_COOKIE,
  BROWSER_PROOF_TTL_MS,
  CSRF_HEADER,
} from '../../src/session/constants/browser-proof';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, E2E_CLIENT_URL, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import * as SESSION_AUTHORITY_TIMEOUTS from '../utils/hook-timeouts';

interface ErrorBody {
  error: { code: string };
}

interface ProofBody {
  data: { token: string };
}

const PRODUCTION_ENVIRONMENT = 'production';

describe('browser proof (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_TIMEOUTS.SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TIMEOUTS.SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // feature:email-password:start
  it('rejects login without a proof and rejects a spent proof without a session cookie', async () => {
    const missing = await request(e2e.httpServer)
      .post('/api/auth/login')
      .send({ email: SEED_USER.email, password: SEED_USER.password });
    expect(missing.status).toBe(403);
    expect((missing.body as ErrorBody).error.code).toBe(
      ErrorCode.CSRF_REQUIRED,
    );

    const proof = await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .expect(200);
    const token = (proof.body as ProofBody).data.token;
    const proofCookie = cookiePair(proof, BROWSER_PROOF_COOKIE);
    const login = await request(e2e.httpServer)
      .post('/api/auth/login')
      .set('Cookie', proofCookie)
      .set(CSRF_HEADER, token)
      .send({ email: SEED_USER.email, password: SEED_USER.password });
    expect(login.status).toBe(200);

    const replay = await request(e2e.httpServer)
      .post('/api/auth/login')
      .set('Cookie', proofCookie)
      .set(CSRF_HEADER, token)
      .send({ email: SEED_USER.email, password: SEED_USER.password });
    expect(replay.status).toBe(403);
    expect((replay.body as ErrorBody).error.code).toBe(ErrorCode.CSRF_INVALID);
  });
  // feature:email-password:end

  // feature:email-password:start
  it('accepts a fresh pre-session proof with a stale session cookie on login', async () => {
    const proof = await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .expect(200);
    const token = (proof.body as ProofBody).data.token;
    const cookie = `${cookiePair(proof, BROWSER_PROOF_COOKIE)}; sid=revoked`;

    const login = await request(e2e.httpServer)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, token)
      .send({ email: SEED_USER.email, password: SEED_USER.password });

    expect(login.status).toBe(200);
  });
  // feature:email-password:end

  // feature:email-password:start
  it('rejects a pre-session proof on a protected route with a valid session', async () => {
    const agent = request.agent(e2e.httpServer);
    const sessionProof = await agent.get('/api/auth/browser-proof').expect(200);
    const sessionToken = (sessionProof.body as ProofBody).data.token;
    await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, sessionToken)
      .send({ email: SEED_USER.email, password: SEED_USER.password })
      .expect(200);

    const preSessionProof = await agent
      .get('/api/auth/browser-proof')
      .expect(200);
    const preSessionToken = (preSessionProof.body as ProofBody).data.token;
    const response = await agent
      .post('/api/auth/logout')
      .set(CSRF_HEADER, preSessionToken);

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error.code).toBe(
      ErrorCode.CSRF_INVALID,
    );
  });
  // feature:email-password:end

  // feature:email-password:start
  it('accepts either valid proof on public routes with a valid session cookie', async () => {
    const agent = request.agent(e2e.httpServer);
    const preSession = await agent.get('/api/auth/browser-proof').expect(200);
    await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, (preSession.body as ProofBody).data.token)
      .send({ email: SEED_USER.email, password: SEED_USER.password })
      .expect(200);

    const csrf = await agent.get('/api/auth/csrf').expect(200);
    const sessionToken = csrf.headers[CSRF_HEADER];
    const forgotPassword = await agent
      .post('/api/auth/forgot-password')
      .set(CSRF_HEADER, sessionToken)
      .send({ email: SEED_USER.email });
    expect(forgotPassword.status).toBe(200);

    const wrongToken = await agent
      .post('/api/auth/forgot-password')
      .set(CSRF_HEADER, 'wrong-session-token')
      .send({ email: SEED_USER.email });
    expect(wrongToken.status).toBe(403);
    expect((wrongToken.body as ErrorBody).error.code).toBe(
      ErrorCode.CSRF_INVALID,
    );

    const freshPreSession = await agent
      .get('/api/auth/browser-proof')
      .expect(200);
    const acceptedPreSession = await agent
      .post('/api/auth/forgot-password')
      .set(CSRF_HEADER, (freshPreSession.body as ProofBody).data.token)
      .send({ email: SEED_USER.email });
    expect(acceptedPreSession.status).toBe(200);
  });
  // feature:email-password:end

  it('clears the session cookie when a protected request has an invalid session', async () => {
    const response = await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Cookie', 'sid=revoked');

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error.code).toBe(
      ErrorCode.SESSION_INVALID,
    );
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^sid=;/)]),
    );
  });

  it('rejects an expired proof using the injected clock', async () => {
    const proof = await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .expect(200);
    const token = (proof.body as ProofBody).data.token;
    const proofCookie = cookiePair(proof, BROWSER_PROOF_COOKIE);
    e2e.clock.advance(BROWSER_PROOF_TTL_MS + 1);

    const expired = await request(e2e.httpServer)
      .post('/api/auth/login')
      .set('Cookie', proofCookie)
      .set(CSRF_HEADER, token)
      .send({ email: SEED_USER.email, password: SEED_USER.password });

    expect(expired.status).toBe(403);
    expect((expired.body as ErrorBody).error.code).toBe(ErrorCode.CSRF_INVALID);
  });

  it('starts E2E records ahead of MongoDB real-time TTL', () => {
    expect(e2e.clock.now().toISOString()).toBe('2099-01-01T12:00:00.000Z');
  });

  it('allows the configured origin in production without seeding applications', async () => {
    const production = await bootE2eApp(0, { nodeEnv: 'production' });
    try {
      const applications = production.state.applications;
      const sessionModule = production.app.get(SessionModule);
      await applications.removeApplicationsIn(PRODUCTION_ENVIRONMENT);

      await sessionModule.onModuleInit();
      expect(
        await applications.applicationCountIn(PRODUCTION_ENVIRONMENT),
      ).toBe(0);

      await applications.registerBrowserApplication({
        clientId: WEB_CLIENT_ID,
        displayName: 'Web',
        platform: APPLICATION_PLATFORM.WEB,
        environment: PRODUCTION_ENVIRONMENT,
        clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
        allowedOrigins: [],
      });
      await applications.registerBrowserApplication({
        clientId: ADMIN_CLIENT_ID,
        displayName: 'Admin',
        platform: APPLICATION_PLATFORM.ADMIN,
        environment: PRODUCTION_ENVIRONMENT,
        clientType: APPLICATION_CLIENT_TYPE.CONFIDENTIAL,
        allowedOrigins: [],
      });
      await sessionModule.onModuleInit();

      const allowedOrigin = await request(production.httpServer)
        .post('/api/auth/login')
        .set('Origin', E2E_CLIENT_URL)
        .set('Sec-Fetch-Site', 'same-site');
      expect(allowedOrigin.status).toBe(403);
      expect((allowedOrigin.body as ErrorBody).error.code).toBe(
        ErrorCode.CSRF_REQUIRED,
      );

      const foreignOrigin = await request(production.httpServer)
        .post('/api/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Sec-Fetch-Site', 'same-site');
      expect(foreignOrigin.status).toBe(403);
      expect((foreignOrigin.body as ErrorBody).error.code).toBe(
        ErrorCode.ORIGIN_REJECTED,
      );

      await sessionModule.onModuleInit();
      const web = await applications.application(
        WEB_CLIENT_ID,
        PRODUCTION_ENVIRONMENT,
      );
      const admin = await applications.application(
        ADMIN_CLIENT_ID,
        PRODUCTION_ENVIRONMENT,
      );
      expect(web?.allowedOrigins).toEqual(['http://127.0.0.1:3107']);
      expect(admin?.allowedOrigins).toEqual(['http://127.0.0.1:3107']);
    } finally {
      await production.close();
    }
  });

  // feature:email-password:start
  it('rejects a public browser-session route carrying both a cookie and a bearer', async () => {
    const proof = await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .expect(200);
    const token = (proof.body as ProofBody).data.token;
    const session = request.agent(e2e.httpServer);
    await session
      .post('/api/auth/login')
      .set('Cookie', cookiePair(proof, BROWSER_PROOF_COOKIE))
      .set(CSRF_HEADER, token)
      .send({ email: SEED_USER.email, password: SEED_USER.password })
      .expect(200);

    const mixed = await session
      .post('/api/auth/login')
      .set('Authorization', 'Bearer native-token')
      .send({ email: SEED_USER.email, password: SEED_USER.password });
    expect(mixed.status).toBe(400);
    expect((mixed.body as ErrorBody).error.code).toBe(
      ErrorCode.MIXED_CREDENTIALS,
    );
  });
  // feature:email-password:end

  // feature:email-password:start
  it('rejects a foreign origin and an invalid bearer sent with a cookie', async () => {
    const proof = await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .expect(200);
    const token = (proof.body as ProofBody).data.token;
    const foreign = await request(e2e.httpServer)
      .post('/api/auth/login')
      .set('Cookie', cookiePair(proof, BROWSER_PROOF_COOKIE))
      .set(CSRF_HEADER, token)
      .set('Origin', 'https://evil.example')
      .send({ email: SEED_USER.email, password: SEED_USER.password });
    expect(foreign.status).toBe(403);
    expect((foreign.body as ErrorBody).error.code).toBe(
      ErrorCode.ORIGIN_REJECTED,
    );

    const sessionProof = await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .expect(200);
    const session = request.agent(e2e.httpServer);
    await session
      .post('/api/auth/login')
      .set('Cookie', cookiePair(sessionProof, BROWSER_PROOF_COOKIE))
      .set(CSRF_HEADER, (sessionProof.body as ProofBody).data.token)
      .send({ email: SEED_USER.email, password: SEED_USER.password })
      .expect(200);
    const invalidBearer = await session
      .get('/api/user/profile')
      .set('Authorization', 'Bearer native-token');
    // Native sign-in stays off in this file, so the bearer attempt fails
    // closed here instead of falling back to the cookie.
    expect(invalidBearer.status).toBe(403);
    expect((invalidBearer.body as ErrorBody).error.code).toBe(
      ErrorCode.NATIVE_AUTH_DISABLED,
    );
  });
  // feature:email-password:end
});

function cookiePair(response: SupertestResponse, name: string): string {
  const setCookie: unknown = response.headers['set-cookie'];
  let cookie: string | undefined;
  if (typeof setCookie === 'string' && setCookie.startsWith(`${name}=`)) {
    cookie = setCookie;
  } else if (Array.isArray(setCookie)) {
    for (const value of setCookie as unknown[]) {
      if (typeof value === 'string' && value.startsWith(`${name}=`)) {
        cookie = value;
        break;
      }
    }
  }
  const [pair] = cookie?.split(';') ?? [];
  if (!pair) {
    throw new Error(`Response did not set ${name}`);
  }
  return pair;
}
