import request from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { refusalAnswer } from '../utils/route-id-answers';

const NEW_USER = {
  email: 'created@seed.local',
  name: 'Created User',
  password: 'Created123!',
  role: 'user',
};

interface CreatedBody {
  success: boolean;
  data: Record<string, unknown> & { id: string };
}

describe('POST /api/admin/users (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
  });

  function stored() {
    return e2e.state.accounts.accountWithAddress(NEW_USER.email);
  }

  it('creates the account an administrator describes, and stores it', async () => {
    const created = await admin.post('/api/admin/users').send(NEW_USER);

    expect(created.status).toBe(201);
    const body = created.body as CreatedBody;
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      email: 'created@seed.local',
      name: 'Created User',
      role: 'user',
      isVerified: true,
      isDeleted: false,
    });
    expect(Object.keys(body.data)).not.toContain('password');
    const account = await stored();
    expect(account).toMatchObject({
      _id: body.data.id,
      email: 'created@seed.local',
      name: 'Created User',
      role: 'user',
      isVerified: true,
      isDeleted: false,
    });
    expect(account?.password).not.toBe(NEW_USER.password);
    const listed = await admin
      .get('/api/admin/users')
      .query({ search: 'created@seed.local' })
      .expect(200);
    expect(
      (listed.body as { data: { data: { id: string }[] } }).data.data.map(
        (user) => user.id,
      ),
    ).toEqual([body.data.id]);
  });

  // feature:email-password:start
  it('lets the created account sign in with the password it was given', async () => {
    await admin.post('/api/admin/users').send(NEW_USER).expect(201);

    const created = await loginAs(e2e.httpServer, NEW_USER);

    const profile = await created.get('/api/user/profile').expect(200);
    expect(profile.body).toMatchObject({
      data: { email: 'created@seed.local', role: 'user' },
    });
  });
  // feature:email-password:end

  it('refuses an address that is taken and stores no second account', async () => {
    const refused = await admin
      .post('/api/admin/users')
      .send({ ...NEW_USER, email: SEED_USER.email });

    expect(refusalAnswer(refused)).toMatchObject({
      status: 409,
      success: false,
      code: ErrorCode.EMAIL_ALREADY_EXISTS,
    });
    expect(await e2e.state.auth.countAccountsWithAddress(SEED_USER.email)).toBe(
      1,
    );
  });

  it.each([
    ['the administrator role', 'admin', 400, ErrorCode.INVALID_ROLE_ASSIGNMENT],
    [
      'a role that does not exist',
      'no-such-role',
      404,
      ErrorCode.ROLE_NOT_FOUND,
    ],
  ])('refuses %s and stores nothing', async (_label, role, status, code) => {
    const refused = await admin
      .post('/api/admin/users')
      .send({ ...NEW_USER, role });

    expect(refusalAnswer(refused)).toMatchObject({
      status,
      success: false,
      code,
    });
    expect(await stored()).toBeNull();
  });

  it.each([
    [
      'no password',
      { email: NEW_USER.email, name: NEW_USER.name, role: 'user' },
    ],
    [
      'a password with no digit or symbol',
      { ...NEW_USER, password: 'onlyletters' },
    ],
    ['an address that is not one', { ...NEW_USER, email: 'not-an-address' }],
    ['a field the body does not declare', { ...NEW_USER, isVerified: false }],
  ])('refuses a body with %s and stores nothing', async (_label, body) => {
    const refused = await admin.post('/api/admin/users').send(body);

    expect(refusalAnswer(refused)).toMatchObject({
      status: 400,
      success: false,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(await stored()).toBeNull();
  });

  it('refuses an account without the permission and stores nothing', async () => {
    const user = await loginAs(e2e.httpServer, SEED_USER);

    const refused = await user.post('/api/admin/users').send(NEW_USER);

    expect(refusalAnswer(refused)).toMatchObject({
      status: 403,
      success: false,
      code: ErrorCode.FORBIDDEN,
    });
    expect(await stored()).toBeNull();
  });

  it('refuses a browser that is not signed in and stores nothing', async () => {
    const anonymous = await browserAgent(e2e.httpServer);

    const refused = await anonymous.post('/api/admin/users').send(NEW_USER);

    expect(refusalAnswer(refused)).toMatchObject({
      status: 401,
      success: false,
      code: ErrorCode.SESSION_REQUIRED,
    });
    expect(await stored()).toBeNull();
    await request(e2e.httpServer).get('/health').expect(200);
  });
});
