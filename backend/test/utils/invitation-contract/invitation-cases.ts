import {
  INVITATION_PURPOSE,
  INVITATION_STATUS,
} from '../../../src/auth/invitations/constants/invitations';
import type { InvitationHarnessSource } from './invitation-harness';
import { EMAIL, insert, LIFETIME_MS } from './invitation-support';

export function invitationCases(current: InvitationHarnessSource): void {
  // Retaining an old hash after resend permits a replaced credential to be replayed.
  it('finds by hash and invalidates the old hash when replaced', async () => {
    const h = current();
    const invitation = await insert(h);
    await h.runner().run(async (work) => {
      expect((await h.store.takeByTokenHash(work, 'original-hash'))?.id).toBe(
        invitation.id,
      );
      await h.store.replaceToken(work, invitation.id, {
        tokenHash: 'replacement-hash',
        expiresAt: new Date(h.clock.now().getTime() + 2 * LIFETIME_MS),
        purgeAfter: new Date('2099-03-01T00:00:00Z'),
        now: h.clock.now(),
      });
    });
    await h.runner().run(async (work) => {
      expect(await h.store.takeByTokenHash(work, 'original-hash')).toBeNull();
      expect(
        (await h.store.takeByTokenHash(work, 'replacement-hash'))?.id,
      ).toBe(invitation.id);
    });
    expect((await h.store.findById(invitation.id))?.tokenHash).toBe(
      'replacement-hash',
    );
  });

  // The staff list must not expose account recovery links or another audience's invitations.
  it('excludes enrolment, treats an absent audience as customer and uses newest-first 1-based pages', async () => {
    const h = current();
    const first = await insert(h);
    h.clock.advance(1);
    const second = await insert(h, {
      tokenHash: 'staff-hash',
      audience: 'staff',
    });
    h.clock.advance(1);
    const third = await insert(h, {
      tokenHash: 'customer-hash',
      audience: 'customer',
      purpose: INVITATION_PURPOSE.FIRST_ADMIN,
    });
    const userId = await h.seedAccount(EMAIL);
    await insert(h, {
      tokenHash: 'enrolment-hash',
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
    });
    const query = { page: 1, limit: 2, now: h.clock.now() };
    const page = await h.store.list(query);
    expect(page.total).toBe(3);
    expect(page.invitations.map(({ id }) => id)).toEqual([third.id, second.id]);
    expect(
      (await h.store.list({ ...query, page: 2 })).invitations.map(
        ({ id }) => id,
      ),
    ).toEqual([first.id]);
    expect((await h.store.list({ ...query, page: 3 })).invitations).toEqual([]);
    expect(
      (
        await h.store.list({ ...query, audiences: ['customer'] })
      ).invitations.map(({ id }) => id),
    ).toEqual([third.id, first.id]);
    expect(
      (await h.store.list({ ...query, audiences: ['staff'] })).invitations.map(
        ({ id }) => id,
      ),
    ).toEqual([second.id]);
    expect(await h.store.list({ ...query, audiences: [] })).toEqual({
      invitations: [],
      total: 0,
    });
  });

  // Misclassifying spent or expired tokens can expose unusable credentials as pending.
  it('derives disjoint statuses and expires exactly at the deadline', async () => {
    const h = current();
    const pending = await insert(h);
    const accepted = await insert(h, { tokenHash: 'accepted' });
    const revoked = await insert(h, { tokenHash: 'revoked' });
    const expired = await insert(h, {
      tokenHash: 'expired',
      expiresAt: h.clock.now(),
    });
    await h.runner().run(async (work) => {
      await h.store.markAccepted(work, accepted.id, h.clock.now());
      await h.store.markRevoked(work, accepted.id, h.clock.now());
      await h.store.markRevoked(work, revoked.id, h.clock.now());
    });
    for (const [status, id] of [
      [INVITATION_STATUS.PENDING, pending.id],
      [INVITATION_STATUS.ACCEPTED, accepted.id],
      [INVITATION_STATUS.REVOKED, revoked.id],
      [INVITATION_STATUS.EXPIRED, expired.id],
    ] as const) {
      const page = await h.store.list({
        status,
        page: 1,
        limit: 10,
        now: h.clock.now(),
      });
      expect(page.total).toBe(1);
      expect(page.invitations.map((row) => row.id)).toEqual([id]);
    }
  });

  // A stale administrator invitation must not prevent safe first-administrator recovery.
  it.each([INVITATION_PURPOSE.ACCOUNT, INVITATION_PURPOSE.FIRST_ADMIN])(
    'counts only live unspent administrator invitations for %s',
    async (purpose) => {
      const h = current();
      const query = () =>
        h
          .runner()
          .run((work) =>
            h.store.hasOpenAdminInvitation(work, 'admin', h.clock.now()),
          );
      expect(await query()).toBe(false);
      await insert(h, { roleSlug: 'user' });
      expect(await query()).toBe(false);
      const accepted = await insert(h, {
        purpose,
        roleSlug: 'admin',
        tokenHash: 'accepted',
      });
      const revoked = await insert(h, {
        purpose,
        roleSlug: 'admin',
        tokenHash: 'revoked',
      });
      await insert(h, {
        purpose,
        roleSlug: 'admin',
        tokenHash: 'expired',
        expiresAt: h.clock.now(),
      });
      await h.runner().run(async (work) => {
        await h.store.markAccepted(work, accepted.id, h.clock.now());
        await h.store.markRevoked(work, revoked.id, h.clock.now());
      });
      expect(await query()).toBe(false);
      await insert(h, { purpose, roleSlug: 'admin', tokenHash: 'live' });
      expect(await query()).toBe(true);
    },
  );

  // Resetting one account must neither preserve its old open link nor revoke another account's link.
  it('revokes only the selected account open enrolment links', async () => {
    const h = current();
    const userId = await h.seedAccount(EMAIL);
    const otherId = await h.seedAccount('other@example.test');
    const open = await insert(h, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
    });
    const foreign = await insert(h, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId: otherId,
      tokenHash: 'foreign',
    });
    const accepted = await insert(h, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      tokenHash: 'accepted',
    });
    const revoked = await insert(h, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      tokenHash: 'revoked',
    });
    const expired = await insert(h, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      tokenHash: 'expired',
      expiresAt: h.clock.now(),
    });
    const account = await insert(h, { tokenHash: 'account' });
    const prior = new Date(h.clock.now().getTime() - 1);
    await h.runner().run(async (work) => {
      await h.store.markAccepted(work, accepted.id, prior);
      await h.store.markRevoked(work, revoked.id, prior);
      expect(
        await h.store.revokeOpenEnrolmentLinks(work, userId, h.clock.now()),
      ).toBe(1);
    });
    expect((await h.store.findById(open.id))?.revokedAt).toEqual(h.clock.now());
    for (const invitation of [foreign, accepted, expired, account]) {
      expect(
        (await h.store.findById(invitation.id))?.revokedAt,
      ).toBeUndefined();
    }
    expect((await h.store.findById(revoked.id))?.revokedAt).toEqual(prior);
  });
}
