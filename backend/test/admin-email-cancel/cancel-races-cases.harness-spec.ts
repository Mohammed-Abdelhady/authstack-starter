import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { AdminModule } from '../../src/admin/admin.module';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { VerificationCodeService } from '../../src/auth/services/codes/verification-code.service';
import { browserAgent, type E2eApp } from '../utils/e2e-app';
import { holdBefore, RaceGate } from '../utils/race-gate';
import {
  beginStaffChange,
  cancelFixture,
  WANTED_ADDRESS,
} from './cancel-fixtures.harness-spec';

type Current = () => {
  e2e: E2eApp;
  fixture: Awaited<ReturnType<typeof cancelFixture>>;
};

export function cancellationRaceCases(current: Current): void {
  reservedConfirmationRace(current);
  committedConfirmationRace(current);
  resendCancellationRace(current);
}

function reservedConfirmationRace(current: Current): void {
  it('invalidates an already-reserved confirmation when cancellation commits first', async () => {
    const { e2e, fixture } = current();
    const { code, pending } = await beginStaffChange(e2e, fixture);
    const browser = await browserAgent(e2e.httpServer);
    const gate = new RaceGate();
    const restore = holdBefore(
      e2e.app.get(VerificationCodeService),
      'consumeCode',
      (call) => (call === 0 ? gate : undefined),
    );
    const confirmation = Promise.resolve(
      browser
        .post('/api/auth/confirm-email-change')
        .send({ email: WANTED_ADDRESS, code }),
    );
    try {
      await gate.reached();
      await fixture.client.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      });
      gate.release();
      expect((await confirmation).status).toBe(400);
      expect(await e2e.state.accounts.accountWithId(pending.id)).toMatchObject({
        email: pending.email,
      });
      expect(
        (await e2e.state.accounts.accountWithId(pending.id))?.pendingEmail,
      ).toBeUndefined();
    } finally {
      gate.release();
      restore();
      await confirmation;
    }
  });
}

function committedConfirmationRace(current: Current): void {
  it('refuses an old cancellation after confirmation has moved the primary address', async () => {
    const { e2e, fixture } = current();
    const { code, pending } = await beginStaffChange(e2e, fixture);
    const browser = await browserAgent(e2e.httpServer);
    await browser
      .post('/api/auth/confirm-email-change')
      .send({ email: WANTED_ADDRESS, code })
      .expect(200);
    await expect(
      fixture.client.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await e2e.state.accounts.accountWithId(pending.id))?.email).toBe(
      WANTED_ADDRESS,
    );
  });
}

function resendCancellationRace(current: Current): void {
  it('refuses a held resend after cancellation has advanced the pending generation', async () => {
    const { e2e, fixture } = current();
    const { pending } = await beginStaffChange(e2e, fixture);
    const mail = (await e2e.captureMail()).length;
    const gate = new RaceGate();
    const restore = holdBefore(
      e2e.app.select(AdminModule).get(AdminAccountStore, { strict: true }),
      'takeEmailChangeTarget',
      (call) => (call === 0 ? gate : undefined),
    );
    const resend = fixture.client.admin.accounts
      .resendEmailChange(pending.id, { version: pending.version })
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      await Promise.race([
        gate.reached(),
        resend.then((outcome) => {
          throw new Error('The resend settled before the held store call', {
            cause: outcome,
          });
        }),
      ]);
      await fixture.client.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      });
      gate.release();
      expect(await resend).toMatchObject({
        status: 409,
        code: ErrorCode.CONFLICT,
      });
      expect((await e2e.captureMail()).length).toBe(mail);
      expect(
        (await e2e.state.accounts.accountWithId(pending.id))?.pendingEmail,
      ).toBeUndefined();
    } finally {
      gate.release();
      restore();
      await resend;
    }
  });
}
