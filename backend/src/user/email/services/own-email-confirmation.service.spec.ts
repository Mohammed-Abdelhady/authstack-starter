import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ADDRESS_CLAIM_KIND } from '../../../common/persistence/address-ledger';
import { MAIL_CATALOGUES } from '../../../mail/catalog/mail-catalogue';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import {
  ACCOUNT_ID,
  addAccount,
  KEPT_SESSION,
  mailedCode,
  OLD_ADDRESS,
  OTHER_SESSION,
  ownEmailWorld,
  OwnEmailWorld,
} from '../testing/own-email-world.harness-spec';

jest.mock('nodemailer');

const NEW_ADDRESS = 'new@example.test';
const OTHER_ID = 'account-2';
const CODE_SUBJECT = MAIL_CATALOGUES.en.ownEmailChangeCode.subject;
const CHANGED_SUBJECT = MAIL_CATALOGUES.en.securityNotice.emailChangedSubject;

async function lastCodeTo(
  world: OwnEmailWorld,
  address: string,
): Promise<string> {
  const mails = await world.sent();
  return mailedCode(
    mails
      .filter((mail) => mail.to === address && mail.subject === CODE_SUBJECT)
      .at(-1),
  );
}

async function requestCode(
  world: OwnEmailWorld,
  address: string,
): Promise<string> {
  await world.requests.request(world.caller(), address);
  return lastCodeTo(world, address);
}

/** Six digits that are not the mailed code. */
function wrong(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('OwnEmailConfirmationService', () => {
  let world: OwnEmailWorld;

  beforeEach(() => {
    world = ownEmailWorld();
  });

  it('moves the account, keeps this session, ends the others for the email change, and tells the old address', async () => {
    const code = await requestCode(world, NEW_ADDRESS);

    const state = await world.confirmations.confirm(world.caller(), code);

    expect(state).toEqual({ email: NEW_ADDRESS });
    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      email: NEW_ADDRESS,
      pendingEmail: undefined,
      isVerified: true,
    });
    expect(world.ledger.claims.size).toBe(0);
    expect(world.sessions.liveOf(ACCOUNT_ID)).toEqual([KEPT_SESSION]);
    expect(world.sessions.revocations).toEqual([
      {
        userId: ACCOUNT_ID,
        keptSessionId: KEPT_SESSION,
        reason: REVOKED_REASON.EMAIL_CHANGED,
      },
    ]);
    const notices = (await world.sent()).filter(
      (mail) => mail.subject === CHANGED_SUBJECT,
    );
    expect(notices.map((mail) => mail.to)).toEqual([OLD_ADDRESS]);
  });

  it('answers the shared code error when nothing is pending, and counts no guess', async () => {
    await expect(
      world.confirmations.confirm(world.caller(), '123456'),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });
    expect(world.sessions.revocations).toEqual([]);
  });

  it('refuses a wrong code and changes nothing', async () => {
    const code = await requestCode(world, NEW_ADDRESS);

    await expect(
      world.confirmations.confirm(world.caller(), wrong(code)),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });

    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      email: OLD_ADDRESS,
      pendingEmail: NEW_ADDRESS,
    });
    expect(world.sessions.liveOf(ACCOUNT_ID)).toEqual([
      KEPT_SESSION,
      OTHER_SESSION,
    ]);
  });

  it("refuses another account's code for the address both asked for, and leaves that change alone", async () => {
    // The other account holds the address first; this one is answered alike.
    addAccount(world, { id: OTHER_ID, email: 'other@example.test' });
    world.sessions.signIn(OTHER_ID, 'their-session');
    const them = {
      ...world.caller(),
      userId: OTHER_ID,
      sessionId: 'their-session',
    };
    await world.requests.request(them, NEW_ADDRESS);
    const theirCode = await lastCodeTo(world, NEW_ADDRESS);
    await world.requests.request(world.caller(), NEW_ADDRESS);
    expect(world.ledger.claims.get(NEW_ADDRESS)).toMatchObject({
      owner: OTHER_ID,
      kind: ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE,
    });

    await expect(
      world.confirmations.confirm(world.caller(), theirCode),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });
    expect(world.accounts.row(ACCOUNT_ID).email).toBe(OLD_ADDRESS);

    await expect(world.confirmations.confirm(them, theirCode)).resolves.toEqual(
      { email: NEW_ADDRESS },
    );
  });

  it('rolls everything back when the confirming session has ended, so the code still works from a live one', async () => {
    const code = await requestCode(world, NEW_ADDRESS);
    world.sessions.live.set(ACCOUNT_ID, { ids: [OTHER_SESSION] });

    await expect(
      world.confirmations.confirm(world.caller(), code),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      email: OLD_ADDRESS,
      pendingEmail: NEW_ADDRESS,
    });
    expect(world.ledger.claims.get(NEW_ADDRESS)?.owner).toBe(ACCOUNT_ID);

    world.sessions.signIn(ACCOUNT_ID, KEPT_SESSION);
    await expect(
      world.confirmations.confirm(world.caller(), code),
    ).resolves.toEqual({ email: NEW_ADDRESS });
  });

  it('kills the first code when a second request replaces it', async () => {
    const first = await requestCode(world, NEW_ADDRESS);
    await requestCode(world, 'second@example.test');

    await expect(
      world.confirmations.confirm(world.caller(), first),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });
    expect(world.accounts.row(ACCOUNT_ID).email).toBe(OLD_ADDRESS);
  });

  it('kills the code of a cancelled change', async () => {
    const code = await requestCode(world, NEW_ADDRESS);
    await world.requests.cancel(world.caller());

    await expect(
      world.confirmations.confirm(world.caller(), code),
    ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });
    expect(world.accounts.row(ACCOUNT_ID).email).toBe(OLD_ADDRESS);
  });
});
