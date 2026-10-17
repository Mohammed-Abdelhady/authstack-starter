// feature:invitations:start
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { INVITATION_PURPOSE } from '../../../src/auth/invitations/constants/invitations';
import { InvitationIssuer } from '../../../src/auth/invitations/services/invitation-issuer';
import {
  ADDRESS_CLAIM_KIND,
  AddressLedger,
} from '../../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { FrozenClock, TEST_NOW } from '../frozen-clock';

const ADDRESS = 'invitee@example.test';
const MINUTE_MS = 60_000;

export interface InvitationRetentionHarness {
  issuer: InvitationIssuer;
  ledger: AddressLedger;
  runner: UnitOfWorkRunner;
  clock: FrozenClock;
  cleanup(): Promise<void>;
  owners(): Promise<string[]>;
}

export function invitationRetentionCases(
  current: () => InvitationRetentionHarness,
): void {
  it('expires the actual issued claim, recreates it on resend and preserves a different live owner', async () => {
    const h = current();
    const issued = await h.runner.run((work) =>
      h.issuer.issue(work, {
        purpose: INVITATION_PURPOSE.ACCOUNT,
        email: ' INVITEE@Example.Test ',
        role: { id: 'role-id', slug: 'user' },
        clientId: 'web',
        locale: 'en',
        lifetimeMs: MINUTE_MS,
      }),
    );
    h.clock.advance(MINUTE_MS);
    expect(
      await h.runner.run((work) =>
        h.ledger.holdsLiveClaim(work, {
          address: ADDRESS,
          owner: issued.invitation.id,
          now: h.clock.now(),
        }),
      ),
    ).toBe(false);
    await h.cleanup();
    expect(await h.owners()).toEqual([]);

    h.clock.set(TEST_NOW);
    await h.runner.run((work) =>
      h.issuer.reissue(work, issued.invitation, MINUTE_MS),
    );
    expect(await h.owners()).toEqual([issued.invitation.id]);
    await h.cleanup();
    expect(await h.owners()).toEqual([issued.invitation.id]);
    await h.runner.run((work) =>
      h.issuer.reissue(work, issued.invitation, 2 * MINUTE_MS),
    );
    expect(
      await h.runner.run((work) =>
        h.ledger.holdsLiveClaim(work, {
          address: ADDRESS,
          owner: issued.invitation.id,
          now: new Date(TEST_NOW.getTime() + MINUTE_MS),
        }),
      ),
    ).toBe(true);

    await h.runner.run(async (work) => {
      expect(
        await h.ledger.claim(work, {
          address: ADDRESS,
          kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
          owner: 'replacement-owner',
          now: new Date(TEST_NOW.getTime() + 2 * MINUTE_MS),
          lapsesAt: new Date(TEST_NOW.getTime() + 3 * MINUTE_MS),
        }),
      ).toBe('claimed');
      await h.ledger.release(work, {
        address: ADDRESS,
        owner: issued.invitation.id,
      });
    });
    await expect(
      h.runner.run((work) =>
        h.issuer.reissue(work, issued.invitation, MINUTE_MS),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.EMAIL_ALREADY_EXISTS,
    });
    expect(await h.owners()).toEqual(['replacement-owner']);
  });
}
// feature:invitations:end
