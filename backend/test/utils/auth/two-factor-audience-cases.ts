// feature:totp:start
// feature:email-password:start
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ROLE_AUDIENCE } from '../../../src/host/types/host-role.type';
import { reconcileStartupApplications } from '../../../src/session/session.module';
import { SEED_USER } from '../../constants/seed-users';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
} from '../audience-authorization.fixtures';
import { setConfigValue } from '../config-settings';
import type { E2eApp } from '../e2e-app';
import {
  anonymousPost,
  expectNoAuthority,
  reply,
} from './audience-refusal.fixtures';
import { totpCodeAt, type Enrolment } from './two-factor-enrolment';

const STEP_TWO = new Date('2099-01-01T12:00:30.000Z');
const FAR_STEP = new Date('2099-01-01T12:10:00.000Z');

type Enrolled = () => Promise<Enrolment>;

export function twoFactorAudienceCases(
  current: () => E2eApp,
  enrolled: Enrolled,
): void {
  describe('audience refusals at the two-factor boundary', () => {
    let previousAdminUrl: string | undefined;
    beforeEach(() => {
      previousAdminUrl = current()
        .app.get(ConfigService)
        .get<string>('cors.adminUrl');
    });
    afterEach(() => {
      const config = current().app.get(ConfigService);
      setConfigValue(config, 'auth.web.signIn', undefined);
      setConfigValue(config, 'auth.admin.signIn', undefined);
      setConfigValue(config, 'cors.adminUrl', previousAdminUrl);
    });
    // Failure: a correct password for an excluded audience opens a challenge.
    it('refuses before issuing or storing a second-factor challenge', async () => {
      const e2e = current();
      setConfigValue(e2e.app.get(ConfigService), 'cors.adminUrl', ADMIN_ORIGIN);
      await arrangeAudiences(e2e);
      await enrolled();
      const beforeSessions = await e2e.state.sessions.countSessions();
      const beforeChallenges =
        await e2e.state.auth.countSecondFactorChallenges();
      expect(beforeChallenges).toBe(0);
      const wrong = await anonymousPost(e2e, '/api/auth/login', {
        ...SEED_USER,
        password: 'WrongPassword1!',
      });
      const refused = await anonymousPost(e2e, '/api/auth/login', SEED_USER);
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(401);
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(
        beforeChallenges,
      );
      expect(await e2e.state.sessions.countSessions()).toBe(beforeSessions);
    });

    // Failure: the code result reveals that the account is excluded after a challenge was issued.
    it('matches a bad-code reply when admission changes during the challenge', async () => {
      const e2e = current();
      const config = e2e.app.get(ConfigService);
      setConfigValue(config, 'cors.adminUrl', ADMIN_ORIGIN);
      await arrangeAudiences(e2e);
      const { secret } = await enrolled();
      setConfigValue(config, 'auth.admin.signIn', { signUp: 'closed' });
      await reconcileStartupApplications(e2e.app);
      jest.setSystemTime(STEP_TWO);
      e2e.clock.set(STEP_TWO);
      const browser = request.agent(e2e.httpServer);
      const first = await anonymousPost(
        e2e,
        '/api/auth/login',
        SEED_USER,
        browser,
      );
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ data: { requiresTwoFactor: true } });
      const wrong = await anonymousPost(
        e2e,
        '/api/auth/2fa/verify',
        { code: totpCodeAt(secret, FAR_STEP) },
        browser,
      );
      const beforeSessions = await e2e.state.sessions.countSessions();
      setConfigValue(config, 'auth.admin.signIn', {
        audience: ROLE_AUDIENCE.STAFF,
        signUp: 'closed',
      });
      await reconcileStartupApplications(e2e.app);
      const refused = await anonymousPost(
        e2e,
        '/api/auth/2fa/verify',
        { code: totpCodeAt(secret, STEP_TWO) },
        browser,
      );
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(401);
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.sessions.countSessions()).toBe(beforeSessions);
      setConfigValue(config, 'auth.admin.signIn', { signUp: 'closed' });
      await reconcileStartupApplications(e2e.app);
      const admitted = await anonymousPost(
        e2e,
        '/api/auth/2fa/verify',
        { code: totpCodeAt(secret, STEP_TWO) },
        browser,
      );
      expect(admitted.status).toBe(200);
      expect(admitted.body).toMatchObject({
        data: { requiresTwoFactor: false, user: { email: SEED_USER.email } },
      });
      expect(await e2e.state.sessions.countSessions()).toBe(beforeSessions + 1);
    });
  });
}
// feature:email-password:end
// feature:totp:end
