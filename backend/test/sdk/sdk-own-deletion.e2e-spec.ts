import {
  ACCOUNT_DELETION_PATHS,
  HTTP_METHOD,
  TransportError,
  createApiClient,
  deletionReceiptKey,
} from '@app/sdk';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { NativeAccessService } from '../../src/session/native/access/native-access.service';
import { AccountDeletionStore } from '../../src/user/erasure/stores/account-deletion.store';
import { OwnAccountDeletionService } from '../../src/user/services/own-account-deletion.service';
import { AccountProfileStore } from '../../src/user/stores/account-profile.store';
import { SEED_MANAGER, SEED_USER } from '../constants/seed-users';
import { loginAs } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  issueNativeGrantFor,
  NATIVE_CLIENT_ID,
} from '../utils/native/native-authorize.fixtures';
import {
  apiErrorOf,
  bearerClient,
  cookieClient,
  publicClient,
  required,
  signInNative,
  supertestTransport,
} from '../utils/sdk/sdk-transport';
import {
  bootContractApp,
  resetContractApp,
  type E2eApp,
} from '../utils/sdk/sdk-contract.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const FRESHNESS_EXPIRED_MS = 300_001;
const THIRTY_DAYS_MS = 2_592_000_000;
const RECEIPT_BYTES = new Uint8Array(32).fill(43);

function receiptKey(): string {
  return deletionReceiptKey(TEST_NOW.getTime(), RECEIPT_BYTES);
}

describe('SDK own-account deletion requires committed session proof', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootContractApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await resetContractApp(e2e);
    e2e.app.get(ConfigService).set('account.eraseGraceDays', 30);
  });

  it('refuses recent browser and native sign-ins without an ACT and writes no deletion', async () => {
    const { browser, tokens } = await signInNative(e2e);
    const cookie = cookieClient(browser);
    const native = bearerClient(e2e, tokens.accessToken);
    const profile = await native.profile.get();
    for (const client of [cookie, native]) {
      expect(
        await apiErrorOf(
          client.accountDeletion.delete({ receiptKey: receiptKey() }),
        ),
      ).toMatchObject({ status: 401, code: 'REAUTH_REQUIRED' });
    }
    expect(
      await publicClient(e2e).accountDeletion.receipt(receiptKey()),
    ).toMatchObject({ state: 'not_recorded' });
    expect(
      await e2e.app.get(AccountDeletionStore).findEraseAfter(profile.id),
    ).toBeNull();
    expect(
      await e2e.app.get(AccountProfileStore).findAccount(profile.id),
    ).toMatchObject({ isDeleted: false });
    expect((await native.sessions.list()).total).toBe(2);
  });

  it('uses real native email proof, persists deletion and recovers a lost reply by receipt', async () => {
    const { tokens } = await signInNative(e2e);
    const native = bearerClient(e2e, tokens.accessToken);
    const profile = await native.profile.get();
    const authenticated = required(
      await e2e.app.get(NativeAccessService).validate(tokens.accessToken),
      'native session',
    );
    const actor = {
      sessionId: authenticated.id,
      userId: authenticated.userId,
      clientId: authenticated.clientId,
      signedInAt: authenticated.authenticatedAt,
    };
    await native.proof.sendCode();
    const code = await e2e.mailedCode();
    expect((await e2e.captureMail()).at(-1)?.to).toBe(SEED_USER.email);
    expect(await native.proof.verifyCode({ code })).toEqual({
      provedAt: TEST_NOW.toISOString(),
    });
    const transport = supertestTransport(
      () => request(e2e.httpServer),
      tokens.accessToken,
    );
    let lostReplies = 0;
    const losingClient = createApiClient({
      request: async (call) => {
        const response = await transport.request(call);
        if (
          call.method === HTTP_METHOD.DELETE &&
          call.path === ACCOUNT_DELETION_PATHS.account &&
          response.status === 200
        ) {
          lostReplies += 1;
          throw new Error('Synthetic reply loss after committed HTTP response');
        }
        return response;
      },
    });
    await expect(
      losingClient.accountDeletion.delete({ receiptKey: receiptKey() }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(lostReplies).toBe(1);
    const deadline = new Date(
      TEST_NOW.getTime() + THIRTY_DAYS_MS,
    ).toISOString();
    expect(
      await e2e.app.get(AccountProfileStore).findAccount(profile.id),
    ).toMatchObject({ isDeleted: true });
    expect(
      (
        await e2e.app.get(AccountDeletionStore).findEraseAfter(profile.id)
      )?.toISOString(),
    ).toBe(deadline);
    expect(
      await publicClient(e2e).accountDeletion.receipt(receiptKey()),
    ).toMatchObject({ state: 'recorded' });
    expect((await apiErrorOf(native.profile.get())).status).toBe(401);
    const mailCount = (await e2e.captureMail()).length;
    e2e.clock.advance(FRESHNESS_EXPIRED_MS);
    const replay = await e2e.app
      .get(OwnAccountDeletionService)
      .deactivate(actor, receiptKey());
    expect(replay.data.eraseAfter).toBe(deadline);
    expect((await e2e.captureMail()).length).toBe(mailCount);
  });

  it('does not renew an expired ACT when the native credential is refreshed', async () => {
    const { tokens } = await signInNative(e2e);
    const native = bearerClient(e2e, tokens.accessToken);
    await native.proof.sendCode();
    await native.proof.verifyCode({ code: await e2e.mailedCode() });
    e2e.clock.advance(FRESHNESS_EXPIRED_MS);
    const refreshed = await publicClient(e2e).oauth.refresh({
      refreshToken: tokens.refreshToken,
      clientId: NATIVE_CLIENT_ID,
    });
    const current = bearerClient(e2e, refreshed.accessToken);
    expect(
      await apiErrorOf(
        current.accountDeletion.delete({ receiptKey: receiptKey() }),
      ),
    ).toMatchObject({ status: 401, code: 'REAUTH_REQUIRED' });
    expect(
      await publicClient(e2e).accountDeletion.receipt(receiptKey()),
    ).toMatchObject({ state: 'not_recorded' });
    expect((await current.profile.get()).email).toBe(SEED_USER.email);
  });

  it('keeps email challenges bound to the initiating native session, account and app', async () => {
    const { browser, tokens } = await signInNative(e2e);
    const native = bearerClient(e2e, tokens.accessToken);
    const sameAccount = await issueNativeGrantFor(e2e, SEED_USER.email);
    const otherAccount = await issueNativeGrantFor(e2e, SEED_MANAGER.email);
    await native.proof.sendCode();
    const code = await e2e.mailedCode();
    for (const foreign of [
      bearerClient(e2e, sameAccount.accessToken),
      bearerClient(e2e, otherAccount.accessToken),
      cookieClient(browser),
      cookieClient(await loginAs(e2e.httpServer, SEED_MANAGER)),
    ]) {
      expect(
        await apiErrorOf(foreign.proof.verifyCode({ code })),
      ).toMatchObject({ status: 401, code: 'ACTIVATION_CODE_INVALID' });
      expect(
        await apiErrorOf(foreign.accountDeletion.delete({})),
      ).toMatchObject({ status: 401, code: 'REAUTH_REQUIRED' });
    }
    expect(await native.proof.verifyCode({ code })).toEqual({
      provedAt: TEST_NOW.toISOString(),
    });
    expect(await apiErrorOf(native.proof.verifyCode({ code }))).toMatchObject({
      status: 401,
      code: 'ACTIVATION_CODE_INVALID',
    });
  });
});
