import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { toAdminSessionDto } from '../../src/admin/sessions/mappers/admin-session.mapper';
import {
  outcomeOf,
  signIn,
  validates,
} from '../utils/session/authority-contract/authority-contract-support';
import {
  rerunAtOnce,
  WEB_APPLICATION,
} from '../utils/session/issuance-contract/issuance-contract-support';
import {
  StaffSessionHarness,
  staffActor,
} from './session-harness.harness-spec';

export function staffSessionCases(current: () => StaffSessionHarness): void {
  it('ends one staff-selected session immediately and preserves another across applications', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const web = await signIn(harness.authority, targetId, 'web/1');
    const admin = await signIn(harness.authority, targetId, 'admin/1', 'admin');
    const listed = await harness.service().list(targetId, actorId);
    expect(listed.data.targetClass).toBe('customer');
    expect(
      listed.data?.sessions.map(({ clientId }) => clientId).sort(),
    ).toEqual(['admin', 'web']);
    const ended = await harness
      .service()
      .revokeOne(targetId, web.sessionId, actorId);
    expect(ended.data).toEqual({ revoked: true });
    expect([
      await validates(harness.authority, web.token),
      await validates(harness.authority, admin.token),
    ]).toEqual([false, true]);
    const events = (await harness.authority.events()).filter(
      ({ action }) => action === 'session_revoked',
    );
    expect(events).toEqual([
      {
        action: 'session_revoked',
        actorId,
        targetUserId: targetId,
        clientId: 'web',
        sessionId: web.sessionId,
        reasonCode: 'admin_forced',
      },
    ]);
  });

  it('ends a live session hidden by a disabled application and keeps it ended after re-enable', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const session = await signIn(harness.authority, targetId);
    await harness.authority.issuance.seedApplication({
      ...WEB_APPLICATION,
      enabled: false,
    });
    expect((await harness.service().list(targetId, actorId)).data).toEqual({
      sessions: [],
      total: 0,
      targetClass: 'customer',
    });
    expect(
      (await harness.service().revokeOne(targetId, session.sessionId, actorId))
        .data,
    ).toEqual({ revoked: true });
    expect((await harness.authority.session(session.sessionId))?.isValid).toBe(
      false,
    );
    await harness.authority.issuance.seedApplication(WEB_APPLICATION);
    expect(await validates(harness.authority, session.token)).toBe(false);
  });

  it('revokes browser and native sessions in every application', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const browser = await signIn(harness.authority, targetId);
    const native = await signIn(
      harness.authority,
      targetId,
      'native/1',
      'admin',
    );
    await harness.authority.patchSession(native.sessionId, {
      credentialPurpose: 'native_access',
    });
    expect(
      (
        await harness.authority
          .validator()
          .validateById(native.sessionId, false)
      )?.session.id,
    ).toBe(native.sessionId);
    expect((await harness.service().revokeAll(targetId, actorId)).data).toEqual(
      { revokedCount: 2 },
    );
    expect(await validates(harness.authority, browser.token)).toBe(false);
    expect(
      await harness.authority.validator().validateById(native.sessionId, false),
    ).toBeNull();
    expect(
      (await harness.authority.events()).filter(
        ({ action }) => action === 'sessions_revoked_all',
      ),
    ).toEqual([
      {
        action: 'sessions_revoked_all',
        actorId,
        targetUserId: targetId,
        clientId: null,
        sessionId: null,
        reasonCode: 'admin_forced',
      },
    ]);
  });

  it('keeps self-service SELECTED without actor while staff ends carry ADMIN_FORCED', async () => {
    const harness = current();
    const targetId = await harness.authority.issuance.seedAccount();
    const self = await signIn(harness.authority, targetId);
    const staff = await signIn(harness.authority, targetId);
    const actorId = await staffActor(harness);
    const revoker = harness.authority.revoker(rerunAtOnce);
    expect(await revoker.revokeById(self.sessionId, targetId)).toBe(true);
    expect(
      await revoker.revokeById(staff.sessionId, targetId, {
        actorId,
        reasonCode: 'admin_forced',
      }),
    ).toBe(true);
    expect(
      (await harness.authority.events()).filter(
        ({ action }) => action === 'session_revoked',
      ),
    ).toEqual([
      {
        action: 'session_revoked',
        actorId: null,
        targetUserId: targetId,
        clientId: 'web',
        sessionId: self.sessionId,
        reasonCode: 'selected_revoke',
      },
      {
        action: 'session_revoked',
        actorId,
        targetUserId: targetId,
        clientId: 'web',
        sessionId: staff.sessionId,
        reasonCode: 'admin_forced',
      },
    ]);
  });

  it('does not disclose or end a foreign session and refuses a second end', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const foreignId = await harness.authority.issuance.seedAccount();
    const foreign = await signIn(harness.authority, foreignId);
    const selected = await signIn(harness.authority, targetId);
    const end = (sessionId: string) =>
      outcomeOf(harness.service().revokeOne(targetId, sessionId, actorId));
    expect(await end(foreign.sessionId)).toBe(ErrorCode.SESSION_NOT_FOUND);
    expect(await end(harness.authority.absentSessionId())).toBe(
      ErrorCode.SESSION_NOT_FOUND,
    );
    await harness.service().revokeOne(targetId, selected.sessionId, actorId);
    expect(await end(selected.sessionId)).toBe(ErrorCode.SESSION_NOT_FOUND);
    expect(await validates(harness.authority, foreign.token)).toBe(true);
    expect(
      (await harness.authority.events()).filter(
        ({ action }) => action === 'session_revoked',
      ),
    ).toHaveLength(1);
  });

  it('returns USER_NOT_FOUND for missing and deleted targets and honest empty state for a live target', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    expect((await harness.service().list(targetId, actorId)).data).toEqual({
      sessions: [],
      total: 0,
      targetClass: 'customer',
    });
    expect((await harness.service().revokeAll(targetId, actorId)).data).toEqual(
      { revokedCount: 0 },
    );
    await harness.patchAccount(targetId, { deleted: true });
    for (const id of [targetId, harness.authority.issuance.absentAccountId()]) {
      expect(await outcomeOf(harness.service().list(id, actorId))).toBe(
        ErrorCode.USER_NOT_FOUND,
      );
      expect(await outcomeOf(harness.service().revokeAll(id, actorId))).toBe(
        ErrorCode.USER_NOT_FOUND,
      );
    }
  });

  it('maps only the admin DTO allow-list from stored credential records', async () => {
    const harness = current();
    const targetId = await harness.authority.issuance.seedAccount();
    const browser = await signIn(harness.authority, targetId);
    const stored = await harness.authority.authorityStore.findSessionById(
      browser.sessionId,
    );
    if (!stored) throw new Error('session not stored');
    const mapped = toAdminSessionDto(stored);
    expect(Object.keys(mapped).sort()).toEqual([
      'clientId',
      'createdAt',
      'credentialPurpose',
      'deviceName',
      'deviceParts',
      'id',
      'ip',
      'isCurrent',
      'lastUsedAt',
      'userAgent',
    ]);
    expect({
      clientId: mapped.clientId,
      credentialPurpose: mapped.credentialPurpose,
    }).toEqual({ clientId: 'web', credentialPurpose: 'browser_session' });
  });

  it('never forwards unknown runtime context details from single or bulk revocation', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const session = await signIn(harness.authority, targetId);
    const context = {
      actorId,
      reasonCode: 'admin_forced',
      details: {
        passwordHash: 'sentinel-password-hash',
        token: 'sentinel-token',
        code: 'sentinel-code',
        cookie: 'sentinel-cookie',
        headers: { authorization: 'sentinel-header' },
        mailBody: 'sentinel-mail-body',
      },
    };
    const revoker = harness.authority.revoker(rerunAtOnce);
    await revoker.revokeById(session.sessionId, targetId, context);
    await revoker.revokeAllForUser(targetId, context);
    const stored = (
      await harness.events.listRecentForUser(targetId, 10)
    ).filter(
      ({ action }) =>
        action === 'session_revoked' || action === 'sessions_revoked_all',
    );
    expect(stored.map(({ details }) => details)).toEqual([{}, {}]);
    expect(JSON.stringify(stored)).not.toContain('sentinel-');
  });
}
