// feature:passkeys:start
import request from 'supertest';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { AudienceMappingStore } from '../../src/user/stores/audience-mapping.store';
import { audienceMappingPlan } from '../../src/cli/utils/audience-mapping-plan';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import type { ApiBody } from '../types/e2e-responses';
import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import type { E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import { proveStaffAct } from './staff-invitation-fixtures.harness-spec';

const TARGET_EMAIL = 'peer-admin@example.test';

export function staffPasskeyResetCases(
  current: () => { e2e: E2eApp; adminId: string },
): void {
  describe('staff passkey reset', () => {
    let e2e: E2eApp;
    let actorId: string;
    let targetId: string;
    let actor: IssuedBrowserSession;
    let target: IssuedBrowserSession;
    let otherTargetSession: IssuedBrowserSession;
    beforeEach(async () => {
      const setup = current();
      e2e = setup.e2e;
      actorId = setup.adminId;
      targetId = (
        await e2e.state.accounts.createAccount({
          email: TARGET_EMAIL,
          name: 'Peer Admin',
          role: 'admin',
          isVerified: true,
        })
      )._id;
      const mappings = e2e.app.get(AudienceMappingStore);
      await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
        const plan = audienceMappingPlan(
          await mappings.snapshot(work, { lock: true }),
          new Map(),
        );
        for (const { account, audience } of plan.accounts)
          await mappings.mapAccount(work, account, audience);
      });
      for (const credentialId of [
        'c3RhZmYtcmVzZXQta2V5LTE',
        'c3RhZmYtcmVzZXQta2V5LTI',
      ]) {
        await e2e.state.auth.storePasskey(TARGET_EMAIL, {
          credentialId,
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
          deviceType: 'singleDevice',
          backedUp: false,
          name: 'Laptop',
          lastUsedAt: null,
        });
      }
      actor = await issueAudienceBrowser(e2e, actorId);
      target = await issueAudienceBrowser(e2e, targetId);
      otherTargetSession = await issueAudienceBrowser(e2e, targetId);
      await proveStaffAct(e2e, actor);
    });

    // Failure: a recent sign-in substitutes for the peer reset's explicit act.
    it('refuses a peer reset without an act and preserves credentials', async () => {
      const unproved = await issueAudienceBrowser(e2e, actorId);
      const before = (await e2e.captureMail()).length;
      const response = await audienceRequest(
        e2e,
        unproved,
        `/api/admin/users/${targetId}/passkey-reset`,
        'post',
      )
        .send({})
        .expect(401);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.REAUTH_REQUIRED },
      });
      expect(await e2e.state.auth.countPasskeys()).toBe(2);
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(target.sessionToken),
      ).not.toBeNull();
      expect((await e2e.captureMail()).length).toBe(before);
    });

    // Failure: a peer's sessions can be revoked without an act, or a valid act is ignored.
    it('requires an act before ending a peer administrator session', async () => {
      const unproved = await issueAudienceBrowser(e2e, actorId);
      const route = `/api/admin/users/${targetId}/sessions/revoke-all`;
      const refused = await audienceRequest(e2e, unproved, route, 'post')
        .send({})
        .expect(401);
      expect(refused.body).toMatchObject({
        error: { code: ErrorCode.REAUTH_REQUIRED },
      });
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(target.sessionToken),
      ).not.toBeNull();
      await audienceRequest(e2e, actor, route, 'post').send({}).expect(200);
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(target.sessionToken),
      ).toBeNull();
    });

    // Failure: a wildcard holder below administrator rank can end administrator sessions.
    it('refuses a non-administrator wildcard holder even with a fresh act', async () => {
      await e2e.state.records.changeAccountRole(actorId, 'support');
      await e2e.state.records.replaceAccountPermissions(actorId, ['*']);
      const holder = await issueAudienceBrowser(e2e, actorId);
      await proveStaffAct(e2e, holder);
      const response = await audienceRequest(
        e2e,
        holder,
        `/api/admin/users/${targetId}/sessions/revoke-all`,
        'post',
      )
        .send({})
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE },
      });
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(target.sessionToken),
      ).not.toBeNull();
    });

    // Failure: a peer address change skips explicit proof or loses its confirmation mail.
    it('requires an act before moving a peer address and sends notice plus confirmation', async () => {
      const unproved = await issueAudienceBrowser(e2e, actorId);
      const route = `/api/admin/users/${targetId}`;
      const email = 'changed-peer@example.test';
      const refused = await audienceRequest(e2e, unproved, route, 'patch')
        .send({ email })
        .expect(401);
      expect(refused.body).toMatchObject({
        error: { code: ErrorCode.REAUTH_REQUIRED },
      });
      expect(
        await e2e.app.get(AdminAccountStore).findAccount(targetId),
      ).toMatchObject({ email: TARGET_EMAIL });
      const before = (await e2e.captureMail()).length;
      await audienceRequest(e2e, actor, route, 'patch')
        .send({ email })
        .expect(200);
      expect(
        (await e2e.captureMail()).slice(before).map((mail) => mail.to),
      ).toEqual([TARGET_EMAIL, email]);
      expect(
        await e2e.app.get(AdminAccountStore).findAccount(targetId),
      ).toMatchObject({ pendingEmail: email });
      expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
    });

    // Failure: repeated reset with the old version invalidates the first issued enrollment link.
    it('advances the account version and refuses a stale second reset', async () => {
      const version =
        (await e2e.app.get(AdminAccountStore).findAccount(targetId))?.version ??
        0;
      const route = `/api/admin/users/${targetId}/passkey-reset`;
      const response = await audienceRequest(e2e, actor, route, 'post')
        .send({ version })
        .expect(200);
      expect((response.body as ApiBody<{ version: number }>).data.version).toBe(
        version + 1,
      );
      const before = (await e2e.captureMail()).length;
      const refused = await audienceRequest(e2e, actor, route, 'post')
        .send({ version })
        .expect(409);
      expect(refused.body).toMatchObject({
        error: { code: ErrorCode.CONFLICT },
      });
      expect((await e2e.captureMail()).length).toBe(before);
    });

    // Failure: a peer reset leaves usable passkeys or sessions, or sends no recovery notice after commit.
    it('removes passkeys, revokes sessions and mails a usable enrolment link', async () => {
      const before = (await e2e.captureMail()).length;
      const response = await audienceRequest(
        e2e,
        actor,
        `/api/admin/users/${targetId}/passkey-reset`,
        'post',
      )
        .send({})
        .expect(200);
      expect(
        (
          response.body as ApiBody<{
            id: string;
            revokedSessions: number;
            version: number;
          }>
        ).data,
      ).toMatchObject({
        id: targetId,
        revokedSessions: 2,
        version: expect.any(Number),
      });
      expect(await e2e.state.auth.countPasskeys()).toBe(0);
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(target.sessionToken),
      ).toBeNull();
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(actor.sessionToken),
      ).not.toBeNull();
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(otherTargetSession.sessionToken),
      ).toBeNull();
      const mail = await e2e.captureMail();
      expect(mail.slice(before).map((sent) => sent.to)).toEqual([
        TARGET_EMAIL,
        TARGET_EMAIL,
      ]);
      expect(mail.at(-1)?.to).toBe(TARGET_EMAIL);
      const link = mail
        .at(-1)
        ?.text?.split(/\s+/u)
        .find((part) => part.startsWith('http') && part.includes('#'));
      if (!link) throw new Error('Missing enrolment mail link');
      const url = new URL(link);
      expect(url.origin).toBe(ADMIN_ORIGIN);
      const token = new URLSearchParams(url.hash.slice(1)).get('token');
      if (!token) throw new Error('Missing enrolment token');
      const client = request.agent(e2e.httpServer);
      const proof = await client
        .get('/api/auth/browser-proof')
        .set('Origin', ADMIN_ORIGIN)
        .expect(200);
      const csrf = (proof.body as ApiBody<{ token: string }>).data.token;
      const accepted = await client
        .post('/api/auth/invitations/accept')
        .set('Origin', ADMIN_ORIGIN)
        .set(CSRF_HEADER, csrf)
        .send({ token })
        .expect(200);
      expect(accepted.body).toMatchObject({
        purpose: 'enrolment',
        enrolment: true,
        user: { id: targetId },
      });
    });

    // Failure: a reset takes away the only administrator's remaining way to sign in.
    it('preserves the only other administrator who can sign in', async () => {
      await e2e.state.records.moveAddressGeneration(actorId, 0, false);
      const before = (await e2e.captureMail()).length;
      const response = await audienceRequest(
        e2e,
        actor,
        `/api/admin/users/${targetId}/passkey-reset`,
        'post',
      )
        .send({})
        .expect(409);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.CONFLICT },
      });
      expect(await e2e.state.auth.countPasskeys()).toBe(2);
      expect(
        await e2e.app
          .get(Sessions)
          .validateSessionWithoutExtendingIdle(target.sessionToken),
      ).not.toBeNull();
      expect((await e2e.captureMail()).length).toBe(before);
    });
  });
}
// feature:passkeys:end
