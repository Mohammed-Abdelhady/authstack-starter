// feature:passkeys:start
import { applicationCookieName } from '../../src/session/utils/request/application-cookie-name';
import { PASSKEY_CHALLENGE_COOKIE } from '../../src/auth/passkeys/constants/passkeys.constants';
import { SessionIssuanceService } from '../../src/session/services/session-issuance.service';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { PasskeyConfigService } from '../../src/auth/passkeys/services/passkey-config.service';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { NativeAccessService } from '../../src/session/native/access/native-access.service';
import {
  beginNativeAuthorization,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../utils/native/native-authorize.fixtures';
import { publicClient } from '../utils/sdk/sdk-transport';
import { DEFAULT_API_AUDIENCE } from '../../src/session/constants/client-ids';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request, { type Response } from 'supertest';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import {
  INVITATION_PURPOSE,
  ENROLMENT_LINK_LIFETIME_MS,
} from '../../src/auth/invitations/constants/invitations';
import { InvitationIssuer } from '../../src/auth/invitations/services/invitation-issuer';
import {
  attestationCredential,
  createSoftwareAuthenticator,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import type { ApiBody } from '../types/e2e-responses';
import { ADMIN_ORIGIN } from '../utils/audience-authorization.fixtures';
import { SEED_ADMIN } from '../constants/seed-users';
import type { E2eApp } from '../utils/e2e-app';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';

function cookie(response: Response, name: string): string {
  const headers: unknown = response.headers['set-cookie'];
  const found = (Array.isArray(headers) ? headers.map(String) : []).find(
    (value) => value.startsWith(`${name}=`),
  );
  if (!found) throw new Error(`The response did not set ${name}`);
  return found.split(';')[0];
}

export function invitationEnrolmentCases(
  current: () => { e2e: E2eApp; adminId: string },
): void {
  it('accepts an enrollment link, registers with user verification and promotes a usable session', async () => {
    const { e2e, adminId } = current();
    const config = e2e.app.get(ConfigService);
    config.set('passkeys.enabled', true);
    config.set('auth.admin.signIn', {
      audience: ROLE_AUDIENCE.STAFF,
      signUp: 'closed',
      requirePasskey: true,
    });
    await storeBrowserPolicy(e2e, ADMIN_CLIENT_ID, { requirePasskey: true });
    const account = await e2e.app.get(AdminAccountStore).findAccount(adminId);
    if (!account) throw new Error('The enrollment account is missing');
    const issued = await e2e.app.get(UnitOfWorkRunner).run((work) =>
      e2e.app.get(InvitationIssuer).issue(work, {
        purpose: INVITATION_PURPOSE.ENROLMENT,
        userId: adminId,
        audience: ROLE_AUDIENCE.STAFF,
        addressGeneration: account.addressGeneration,
        email: account.email,
        locale: account.locale,
        clientId: ADMIN_CLIENT_ID,
        lifetimeMs: ENROLMENT_LINK_LIFETIME_MS,
      }),
    );
    const browser = request.agent(e2e.httpServer);
    const preauth = await browser
      .get('/api/auth/browser-proof')
      .set('Origin', ADMIN_ORIGIN)
      .expect(200);
    const token = (preauth.body as ApiBody<{ token: string }>).data.token;
    const accepted = await browser
      .post('/api/auth/invitations/accept')
      .set('Origin', ADMIN_ORIGIN)
      .set(CSRF_HEADER, token)
      .send({ token: issued.token })
      .expect(200);
    expect((accepted.body as { enrolment: boolean }).enrolment).toBe(true);
    const name = e2e.app.get(SessionCookieService).nameFor(ADMIN_CLIENT_ID);
    const enrolmentCookie = cookie(accepted, name);
    const csrf = String(accepted.headers[CSRF_HEADER]);
    const options = await request(e2e.httpServer)
      .post('/api/auth/passkeys/register/options')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', enrolmentCookie)
      .set(CSRF_HEADER, csrf)
      .send({ password: SEED_ADMIN.password })
      .expect(200);
    const creation = (
      options.body as ApiBody<{
        challenge: string;
        authenticatorSelection: { userVerification: string };
      }>
    ).data;
    expect(creation.authenticatorSelection.userVerification).toBe('required');
    const response = attestationCredential(
      createSoftwareAuthenticator(randomBytes(32)),
      {
        rpId: new URL(ADMIN_ORIGIN).hostname,
        origin: ADMIN_ORIGIN,
        challenge: creation.challenge,
        flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
        counter: 0,
      },
    );
    const verified = await request(e2e.httpServer)
      .post('/api/auth/passkeys/register/verify')
      .set('Origin', ADMIN_ORIGIN)
      .set(
        'Cookie',
        [
          enrolmentCookie,
          cookie(
            options,
            applicationCookieName(PASSKEY_CHALLENGE_COOKIE, ADMIN_CLIENT_ID),
          ),
        ].join('; '),
      )
      .set(CSRF_HEADER, csrf)
      .send({ response })
      .expect(200);
    const promotedCookie = cookie(verified, name);
    expect(promotedCookie).not.toBe(enrolmentCookie);
    const identity = await request(e2e.httpServer)
      .get('/api/auth/identity')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', promotedCookie)
      .expect(200);
    expect(identity.body).toMatchObject({
      success: true,
      data: { user: { id: adminId } },
    });
    config.set('auth.nativeEnabled', true);
    const target = {
      clientId: NATIVE_CLIENT_ID,
      displayName: 'Shared RP enrollment',
      redirectUris: [NATIVE_REDIRECT],
      allowedScopes: [DEFAULT_API_AUDIENCE],
      audience: ROLE_AUDIENCE.STAFF,
      signUp: 'closed' as const,
      requirePasskey: true,
      signIn: {
        passkeys: true,
        rpId: 'other.example.test',
        origins: ['https://other.example.test'],
      },
    };
    config.set('auth.nativeApplications', [target]);
    await reconcileStartupApplications(e2e.app);
    const wrongParty = await beginNativeAuthorization(e2e);
    await request(e2e.httpServer)
      .post('/api/oauth/authorize/approve')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', promotedCookie)
      .set(CSRF_HEADER, String(verified.headers[CSRF_HEADER]))
      .send({
        transactionId: wrongParty.transactionId,
        expectedUserId: adminId,
      })
      .expect(404);
    const web = e2e.app
      .get(SessionCookieService)
      .applications.configuration(WEB_CLIENT_ID);
    config.set('auth.nativeApplications', [
      {
        ...target,
        signIn: {
          passkeys: true,
          rpId: e2e.app.get(PasskeyConfigService).rpId,
          origins: [web.origin],
        },
      },
    ]);
    await reconcileStartupApplications(e2e.app);
    for (const method of ['password', 'passkey']) {
      const weak = await e2e.app
        .get(SessionIssuanceService)
        .createBrowserSession(
          adminId,
          'Fixture/1',
          '127.0.0.1',
          WEB_CLIENT_ID,
          { authenticationMethods: [method], userVerified: false },
        );
      const pending = await beginNativeAuthorization(e2e);
      await request(e2e.httpServer)
        .post('/api/oauth/authorize/approve')
        .set('Origin', web.origin)
        .set(
          'Cookie',
          `${e2e.app.get(SessionCookieService).nameFor(WEB_CLIENT_ID)}=${weak.sessionToken}`,
        )
        .set(CSRF_HEADER, weak.csrfToken)
        .send({ transactionId: pending.transactionId, expectedUserId: adminId })
        .expect(404);
    }
    config.set('auth.nativeApplications', [
      {
        clientId: NATIVE_CLIENT_ID,
        displayName: 'Shared RP enrollment',
        redirectUris: [NATIVE_REDIRECT],
        allowedScopes: [DEFAULT_API_AUDIENCE],
        audience: ROLE_AUDIENCE.STAFF,
        signUp: 'closed',
        requirePasskey: true,
        signIn: {
          passkeys: true,
          rpId: new URL(ADMIN_ORIGIN).hostname,
          origins: [ADMIN_ORIGIN],
        },
      },
    ]);
    await reconcileStartupApplications(e2e.app);
    const started = await beginNativeAuthorization(e2e);
    const approval = await request(e2e.httpServer)
      .post('/api/oauth/authorize/approve')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', promotedCookie)
      .set(CSRF_HEADER, String(verified.headers[CSRF_HEADER]))
      .send({ transactionId: started.transactionId, expectedUserId: adminId })
      .expect(200);
    const code = new URL(
      (approval.body as ApiBody<{ redirectUri: string }>).data.redirectUri,
    ).searchParams.get('code');
    if (!code) throw new Error('Missing native code');
    const native = await publicClient(e2e).oauth.exchangeCode({
      code,
      codeVerifier: started.verifier,
      clientId: NATIVE_CLIENT_ID,
      redirectUri: NATIVE_REDIRECT,
    });
    const nativeSession = await e2e.app
      .get(NativeAccessService)
      .validate(native.accessToken);
    expect({
      id: nativeSession?.user?.id,
      uv: nativeSession?.userVerified,
      methods: nativeSession?.authenticationMethods,
    }).toEqual({ id: adminId, uv: true, methods: ['hwk'] });
    const replayProof = await browser
      .get('/api/auth/browser-proof')
      .set('Origin', ADMIN_ORIGIN)
      .expect(200);
    await browser
      .post('/api/auth/invitations/accept')
      .set('Origin', ADMIN_ORIGIN)
      .set(
        CSRF_HEADER,
        (replayProof.body as ApiBody<{ token: string }>).data.token,
      )
      .send({ token: issued.token })
      .expect(400);
  });
}
// feature:passkeys:end
