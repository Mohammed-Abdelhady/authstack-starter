import { RaceGate } from '../race-gate';
import { InvitationIssuer } from '../../../src/auth/invitations/services/invitation-issuer';
import { INVITATION_PURPOSE } from '../../../src/auth/invitations/constants/invitations';
import { AppException } from '../../../src/common/exceptions/app.exception';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { hashToken } from '../../../src/session/utils/hashing/token-hash';
import type { InvitationIssueInput } from '../../../src/auth/invitations/types/invitation-issue';
import type { InvitationHarnessSource } from './invitation-harness';
import { EMAIL, LIFETIME_MS } from './invitation-support';

export function invitationIssuerCases(current: InvitationHarnessSource): void {
  const input: InvitationIssueInput = {
    purpose: INVITATION_PURPOSE.ACCOUNT,
    email: '  INVITEE@EXAMPLE.TEST  ',
    role: { id: 'role-id', slug: 'user' },
    clientId: 'web',
    locale: 'en',
    lifetimeMs: LIFETIME_MS,
  };
  // Invitations must reserve their address until revocation and replace credentials on resend.
  it('claims the normalised address, extends on reissue, and releases on revoke', async () => {
    const h = current();
    const issuer = new InvitationIssuer(h.store, h.ledger, h.clock);
    const issued = await h.runner().run((work) => issuer.issue(work, input));
    expect(issued.invitation.email).toBe(EMAIL);
    expect(issued.invitation.tokenHash).toBe(hashToken(issued.token));
    expect(issued.invitation.tokenHash).not.toBe(issued.token);
    expect(
      await h
        .runner()
        .run((work) =>
          h.ledger.isFree(work, { address: EMAIL, now: h.clock.now() }),
        ),
    ).toBe(false);
    h.clock.advance(LIFETIME_MS - 1);
    const replacement = await h
      .runner()
      .run((work) => issuer.reissue(work, issued.invitation, LIFETIME_MS));
    h.clock.advance(1);
    expect(
      await h.runner().run((work) =>
        h.ledger.holdsLiveClaim(work, {
          address: EMAIL,
          owner: issued.invitation.id,
          now: h.clock.now(),
        }),
      ),
    ).toBe(true);
    await h.runner().run(async (work) => {
      expect(
        await h.store.takeByTokenHash(work, hashToken(issued.token)),
      ).toBeNull();
      expect(
        (await h.store.takeByTokenHash(work, hashToken(replacement)))?.id,
      ).toBe(issued.invitation.id);
      await issuer.revoke(work, issued.invitation, h.clock.now());
    });
    expect(
      await h
        .runner()
        .run((work) =>
          h.ledger.isFree(work, { address: EMAIL, now: h.clock.now() }),
        ),
    ).toBe(true);
  });

  // An invitation to an existing account must fail without persisting an unusable invitation or claim.
  it('rolls back a taken-address issue', async () => {
    const h = current();
    await h.seedAccount(EMAIL);
    const issuer = new InvitationIssuer(h.store, h.ledger, h.clock);
    let failure: unknown;
    try {
      await h.runner().run((work) => issuer.issue(work, input));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AppException);
    if (!(failure instanceof AppException))
      throw new Error('Expected address conflict');
    expect(failure.code).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
    expect(failure.getStatus()).toBe(409);
    expect(
      (await h.store.list({ page: 1, limit: 10, now: h.clock.now() })).total,
    ).toBe(0);
  });

  // A reset must retire the previous link without claiming the existing account's address.
  it('replaces open enrolment links for that account without an address claim', async () => {
    const h = current();
    const userId = await h.seedAccount(EMAIL);
    const issuer = new InvitationIssuer(h.store, h.ledger, h.clock);
    const enrolment = {
      ...input,
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      addressGeneration: 0,
    };
    const first = await h.runner().run((work) => issuer.issue(work, enrolment));
    const second = await h
      .runner()
      .run((work) => issuer.issue(work, enrolment));
    expect((await h.store.findById(first.invitation.id))?.revokedAt).toEqual(
      h.clock.now(),
    );
    expect(
      (await h.store.findById(second.invitation.id))?.revokedAt,
    ).toBeUndefined();
    expect(
      await h.runner().run((work) =>
        h.ledger.holdsLiveClaim(work, {
          address: EMAIL,
          owner: second.invitation.id,
          now: h.clock.now(),
        }),
      ),
    ).toBe(false);
  });
  // Concurrent resets must leave only the last-issued enrolment credential usable.
  it('serialises enrolment issues even when the account has no prior links', async () => {
    const h = current();
    const userId = await h.seedAccount(EMAIL);
    const issuer = new InvitationIssuer(h.store, h.ledger, h.clock);
    const enrolment = {
      ...input,
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      addressGeneration: 0,
    };
    const held = new RaceGate();
    const committed = new RaceGate();
    const contending = h.contention(committed.hold());
    const first = h.runner().run(async (work) => {
      const issued = await issuer.issue(work, enrolment);
      await held.hold();
      return issued;
    });
    let second: ReturnType<InvitationIssuer['issue']> | undefined;
    let observer: Promise<void> | undefined;
    try {
      await Promise.race([
        held.reached(),
        first.then(() => {
          throw new Error('First issuer passed the gate');
        }),
      ]);
      second = contending.runner.run((work) => issuer.issue(work, enrolment));
      observer = contending.blocked();
      await Promise.race([
        observer,
        second.then(() => {
          throw new Error(
            'Second issuer completed before the account lock was released',
          );
        }),
      ]);
      held.release();
      const earlier = await first;
      committed.release();
      const later = await second;
      expect(
        (await h.store.findById(earlier.invitation.id))?.revokedAt,
      ).toEqual(h.clock.now());
      expect(
        (await h.store.findById(later.invitation.id))?.revokedAt,
      ).toBeUndefined();
    } finally {
      contending.stop();
      held.release();
      committed.release();
      await Promise.allSettled([first, second, observer]);
    }
  });
}
