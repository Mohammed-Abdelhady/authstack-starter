import { nativeProviderLinkCases } from './native-provider-link-cases.harness-spec'; // feature:google
import { PasskeyManagementService } from '../../src/auth/passkeys/services/passkey-management.service';
import { PasskeyStore } from '../../src/auth/passkeys/stores/passkey.store';
import { PasskeyConfigService } from '../../src/auth/passkeys/services/passkey-config.service';
import { RequiredPasskeyRelyingParties } from '../../src/auth/passkeys/services/required-passkey-relying-parties.service';
import { BrowserApplications } from '../../src/session/applications/browser-applications';
import { SignInMethodRule } from '../../src/user/services/sign-in-method.rule';
import { SecurityNoticeService } from '../../src/user/services/security-notice.service';
import { AccountProfileStore } from '../../src/user/stores/account-profile.store';
import {
  UnitOfWorkRunner,
  type UnitOfWork,
} from '../../src/common/persistence/unit-of-work';
import {
  apiErrorOf,
  bearerClient,
  publicClient,
} from '../utils/sdk/sdk-transport';
import { NativeAccessService } from '../../src/session/native/access/native-access.service';
import { ConfigService } from '@nestjs/config';
import request, { type Response } from 'supertest';
import {
  signAssertion,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  type SoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import type { NativeApplicationConfiguration } from '../../src/config/types/native-application.type';
import { reconcileStartupApplications } from '../../src/session/session.module';
import type { E2eApp } from '../utils/e2e-app';
import { issueNativeGrantFor } from '../utils/native/native-authorize.fixtures';
import { SEED_USER } from '../constants/seed-users';

export interface ProofJourney {
  e2e: E2eApp;
  application: NativeApplicationConfiguration;
  register: (
    token: string,
  ) => Promise<{ key: SoftwareAuthenticator; verified: Response }>;
  signIn: (
    key: SoftwareAuthenticator,
    counter: number,
    flags?: number,
  ) => Promise<{
    answered: Response;
    options: Response;
    attempt: { attemptId: string; attemptSecret: string };
    verifier: string;
  }>;
  finish: (
    attempt: { attemptId: string; attemptSecret: string },
    verifier: string,
  ) => Promise<{ accessToken: string; refreshToken: string }>;
}

export function nativeProofCases(current: () => ProofJourney): void {
  nativeProviderLinkCases(current); // feature:google
  it('keeps passkey-removal mail fixed when the account is deactivated before commit', async () => {
    const { e2e, register } = current();
    const first = await issueNativeGrantFor(e2e, SEED_USER.email);
    const registered = await register(first.accessToken);
    expect(registered.verified.status).toBe(200);
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('Missing account');
    const profiles = e2e.app.get(AccountProfileStore);
    const real = e2e.app.get(UnitOfWorkRunner);
    const runner = new (class extends UnitOfWorkRunner {
      run<T>(work: (transaction: UnitOfWork) => Promise<T>): Promise<T> {
        return real.run(async (transaction) => {
          const answer = await work(transaction);
          const account = await profiles.readAccount(transaction, userId);
          if (!account) throw new Error('Missing account');
          await profiles.saveDeactivation(
            transaction,
            account,
            e2e.clock.now(),
          );
          return answer;
        });
      }
    })();
    const management = new PasskeyManagementService(
      e2e.app.get(PasskeyStore),
      e2e.app.get(SignInMethodRule),
      runner,
      e2e.app.get(PasskeyConfigService),
      e2e.app.get(BrowserApplications),
      e2e.app.get(RequiredPasskeyRelyingParties),
      e2e.app.get(SecurityNoticeService),
      profiles,
    );
    const passkeys = await e2e.app.get(PasskeyStore).listForAccount(userId);
    if (!passkeys[0]) throw new Error('Missing passkey');
    const before = (await e2e.captureMail()).length;
    await management.remove(userId, passkeys[0].id);
    const sent = (await e2e.captureMail()).slice(before);
    expect(sent.map(({ to }) => to)).toEqual([SEED_USER.email]);
    expect(await e2e.app.get(PasskeyStore).listForAccount(userId)).toEqual([]);
    expect((await profiles.findAccount(userId))?.isDeleted).toBe(true);
  });

  it('retains actual authentication time after delayed consent and refresh', async () => {
    const { e2e, application, register, signIn, finish } = current();
    const first = await issueNativeGrantFor(e2e, SEED_USER.email);
    const registered = await register(first.accessToken);
    expect(registered.verified.status).toBe(200);
    const authenticatedAt = e2e.clock.now();
    const login = await signIn(registered.key, 1);
    expect(login.answered.status).toBe(201);
    e2e.clock.set(new Date(authenticatedAt.getTime() + 360000));
    const issuedAt = e2e.clock.now();
    const pair = await finish(login.attempt, login.verifier);
    const session = await e2e.app
      .get(NativeAccessService)
      .validate(pair.accessToken);
    expect({
      authenticatedAt: session?.authenticatedAt,
      issuedAt: session?.issuedAt,
    }).toEqual({ authenticatedAt, issuedAt });
    const refreshed = await publicClient(e2e).oauth.refresh({
      refreshToken: pair.refreshToken,
      clientId: application.clientId,
    });
    const refreshedSession = await e2e.app
      .get(NativeAccessService)
      .validate(refreshed.accessToken);
    expect({
      authenticatedAt: refreshedSession?.authenticatedAt,
      issuedAt: refreshedSession?.issuedAt,
    }).toEqual({ authenticatedAt, issuedAt });
    await request(e2e.httpServer)
      .post('/api/user/email')
      .set('Authorization', `Bearer ${refreshed.accessToken}`)
      .send({ email: 'delayed-consent@example.test' })
      .expect(401);
  });

  it('requires a bound native RP and UV proof before resuming the same email action', async () => {
    const { e2e, application, register, signIn, finish } = current();
    const first = await issueNativeGrantFor(e2e, SEED_USER.email);
    const registered = await register(first.accessToken);
    expect(registered.verified.status).toBe(200);
    e2e.app
      .get(ConfigService)
      .set('auth.nativeApplications', [
        { ...application, requirePasskey: true },
      ]);
    await reconcileStartupApplications(e2e.app);
    const beforeRefused = await e2e.state.sessions.countSessions();
    const noUv = await signIn(registered.key, 1, FLAG_USER_PRESENT);
    expect(noUv.options.body).toMatchObject({
      data: { userVerification: 'required' },
    });
    expect(noUv.answered.status).toBe(409);
    await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${noUv.attempt.attemptId}/password`)
      .set('X-Native-Attempt', noUv.attempt.attemptSecret)
      .send(SEED_USER)
      .expect(404);
    const methods = await request(e2e.httpServer)
      .get('/api/auth/native/methods')
      .query({ clientId: application.clientId })
      .expect(200);
    expect(methods.body).toMatchObject({
      data: {
        capabilities: { password: false, emailLink: false, passkeys: true },
        providers: [],
      },
    });
    expect(await e2e.state.sessions.countSessions()).toBe(beforeRefused);
    const login = await signIn(registered.key, 1);
    expect(login.answered.status).toBe(201);
    const session = await finish(login.attempt, login.verifier);
    const post = (
      path: string,
      body: object = {},
      token = session.accessToken,
    ) =>
      request(e2e.httpServer)
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    const email = '/api/user/email';
    const wanted = { email: 'native-proof-new@example.test' };
    await post(email, wanted).expect(401);
    await post(email, { ...wanted, password: SEED_USER.password }).expect(401);
    const prove = async (origin: string, rpId: string, flags: number) => {
      const options = await post('/api/auth/native/proof/options').expect(200);
      const data = options.body as {
        data: { challenge: string; userVerification: string };
      };
      expect(data.data.userVerification).toBe('required');
      const signed = signAssertion(registered.key, {
        origin,
        rpId,
        flags,
        counter: 2,
        challenge: data.data.challenge,
      });
      const assertion = {
        id: registered.key.credentialId,
        rawId: registered.key.credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: signed.clientDataJSON.toString('base64url'),
          authenticatorData: signed.authenticatorData.toString('base64url'),
          signature: signed.signature.toString('base64url'),
        },
      };
      return {
        assertion,
        verify: () => post('/api/auth/native/proof/verify', assertion),
      };
    };
    const rpId = application.signIn?.rpId;
    const origin = application.signIn?.origins?.[0];
    if (!rpId || !origin)
      throw new Error('The native proof relying party is missing');
    const uv = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
    for (const [proofOrigin, proofRpId, flags] of [
      [origin, rpId, FLAG_USER_PRESENT],
      ['https://other.example.test', rpId, uv],
      [origin, 'other.example.test', uv],
    ] as const) {
      await (await prove(proofOrigin, proofRpId, flags)).verify().expect(401);
    }
    await post(email, wanted).expect(401);
    const proved = await prove(origin, rpId, uv);
    await proved.verify().expect(200);
    await proved.verify().expect(401);
    await post(email, wanted).expect(200);
    const other = await signIn(registered.key, 3);
    const otherSession = await finish(other.attempt, other.verifier);
    await post(
      email,
      { email: 'other-session@example.test' },
      otherSession.accessToken,
    ).expect(401);
    const state = await request(e2e.httpServer)
      .get(email)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(state.body).toMatchObject({
      success: true,
      data: { pendingEmail: wanted.email },
    });
    const native = bearerClient(e2e, session.accessToken);
    const profile = await native.profile.get();
    await native.accountDeletion.delete({});
    expect(
      await e2e.app.get(AccountProfileStore).findAccount(profile.id),
    ).toMatchObject({ isDeleted: true });
    expect((await apiErrorOf(native.profile.get())).status).toBe(401);
  });
}
