import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ADDRESS_CLAIM_KIND } from '../../../common/persistence/address-ledger';
import { MAIL_CATALOGUES } from '../../../mail/catalog/mail-catalogue';
import { CREDENTIAL_PURPOSE } from '../../../session/constants/credential-purpose';
import { MemoryLedger } from '../testing/own-email-memory.harness-spec';
import {
  ACCOUNT_ID,
  addAccount,
  OLD_ADDRESS,
  OTHER_SESSION,
  ownEmailWorld,
  OwnEmailWorld,
} from '../testing/own-email-world.harness-spec';

jest.mock('nodemailer');

const NEW_ADDRESS = 'new@example.test';
const HELD_ADDRESS = 'held@example.test';
const PASSWORD = 'Signs-in-with-this-1';
const OTHER_ID = 'account-2';
const CODE_SUBJECT = MAIL_CATALOGUES.en.ownEmailChangeCode.subject;
const REQUESTED_SUBJECT =
  MAIL_CATALOGUES.en.securityNotice.emailChangeRequestedSubject;

async function sentTo(world: OwnEmailWorld): Promise<string[][]> {
  return (await world.sent()).map((mail) => [mail.to, mail.subject]);
}

/** The statements each store call runs on both databases. */
const STATEMENTS = {
  isFree: ['users read', 'claims read'],
  claim: ['claims write', 'users read'],
  release: ['claims write'],
  hasActiveAccount: ['users read'],
  putEmailChangeCodeIn: ['codes write'],
  claimCode: ['codes write'],
} as const;

/** The statements a request for `address` ran around the availability read. */
async function statementsOf(
  world: OwnEmailWorld,
  address: string,
): Promise<string[]> {
  const calls = [
    ['isFree', jest.spyOn(world.ledger, 'isFree')],
    ['claim', jest.spyOn(world.ledger, 'claim')],
    ['release', jest.spyOn(world.ledger, 'release')],
    ['hasActiveAccount', jest.spyOn(world.accounts, 'hasActiveAccount')],
    ['putEmailChangeCodeIn', jest.spyOn(world.codes, 'putEmailChangeCodeIn')],
    ['claimCode', jest.spyOn(world.codes, 'claimCode')],
  ] as const;
  await world.requests.request(world.caller(), address);
  return calls
    .flatMap(([name, spy]) => spy.mock.calls.flatMap(() => STATEMENTS[name]))
    .sort();
}

describe('OwnEmailRequestService', () => {
  let world: OwnEmailWorld;

  beforeEach(() => {
    world = ownEmailWorld();
  });

  it('holds a free address, mails it a code for the next generation and tells the current address', async () => {
    const state = await world.requests.request(
      world.caller(),
      ' New@Example.test ',
    );

    expect(state).toEqual({ email: OLD_ADDRESS, pendingEmail: NEW_ADDRESS });
    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      email: OLD_ADDRESS,
      pendingEmail: NEW_ADDRESS,
      addressGeneration: 4,
    });
    expect(world.ledger.claims.get(NEW_ADDRESS)).toMatchObject({
      owner: ACCOUNT_ID,
      kind: ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE,
    });
    expect([...world.codes.records.values()]).toEqual([
      expect.objectContaining({
        email: NEW_ADDRESS,
        userId: ACCOUNT_ID,
        addressGeneration: 4,
      }),
    ]);
    expect(await sentTo(world)).toEqual([
      [NEW_ADDRESS, CODE_SUBJECT],
      [OLD_ADDRESS, REQUESTED_SUBJECT],
    ]);
  });

  it('refuses a sign-in older than five minutes before anything is held, stored, counted or mailed', async () => {
    await expect(
      world.requests.request(world.caller(6), NEW_ADDRESS),
    ).rejects.toMatchObject({ code: ErrorCode.REAUTH_REQUIRED });

    expect(world.accounts.row(ACCOUNT_ID).pendingEmail).toBeUndefined();
    expect(world.ledger.claims.size).toBe(0);
    expect(world.codes.records.size).toBe(0);
    expect(world.counter.counted).toEqual([]);
    expect(await world.sent()).toEqual([]);
  });

  it("refuses a mobile session's stale actual authentication before any write", async () => {
    const mobile = world.caller(6, CREDENTIAL_PURPOSE.NATIVE_ACCESS);

    await expect(
      world.requests.request(mobile, NEW_ADDRESS),
    ).rejects.toMatchObject({ code: ErrorCode.REAUTH_REQUIRED });

    expect(world.accounts.row(ACCOUNT_ID).pendingEmail).toBeUndefined();
    expect(world.ledger.claims.size).toBe(0);
    expect(world.codes.records.size).toBe(0);
    expect(world.counter.counted).toEqual([]);
    expect(await world.sent()).toEqual([]);
  });

  it('takes the password of an account that has one in place of a recent sign-in, and refuses a wrong one', async () => {
    await world.givePassword(PASSWORD);
    const mobile = world.caller(6, CREDENTIAL_PURPOSE.NATIVE_ACCESS);

    await expect(
      world.requests.request(mobile, NEW_ADDRESS, 'Not-the-password-1'),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CURRENT_PASSWORD });
    expect(world.accounts.row(ACCOUNT_ID).pendingEmail).toBeUndefined();

    await expect(
      world.requests.request(mobile, NEW_ADDRESS, PASSWORD),
    ).resolves.toEqual({ email: OLD_ADDRESS, pendingEmail: NEW_ADDRESS });
  });

  it('refuses the address the account already has, in any case and spacing', async () => {
    await expect(
      world.requests.request(world.caller(), ' OLD@example.TEST'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    expect(world.ledger.claims.size).toBe(0);
    expect(world.counter.counted).toEqual([]);
    expect(await world.sent()).toEqual([]);
  });

  it.each([
    [
      'an account',
      (held: OwnEmailWorld) =>
        addAccount(held, { id: OTHER_ID, email: HELD_ADDRESS }),
    ],
    [
      'a pending change',
      (held: OwnEmailWorld) =>
        held.ledger.claims.set(HELD_ADDRESS, {
          address: HELD_ADDRESS,
          owner: OTHER_ID,
          kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
          lapsesAt: new Date('2099-01-02T00:00:00.000Z'),
        }),
    ],
    // feature:invitations:start
    [
      'an invitation',
      (held: OwnEmailWorld) =>
        held.ledger.claims.set(HELD_ADDRESS, {
          address: HELD_ADDRESS,
          owner: 'invitation-1',
          kind: ADDRESS_CLAIM_KIND.INVITATION,
          lapsesAt: new Date('2099-01-02T00:00:00.000Z'),
        }),
    ],
    // feature:invitations:end
  ])(
    'answers an address held by %s exactly like a free one, and sends it no code',
    async (_holder, hold) => {
      hold(world);
      const owner = world.ledger.claims.get(HELD_ADDRESS)?.owner;

      const state = await world.requests.request(world.caller(), HELD_ADDRESS);

      expect(state).toEqual({ email: OLD_ADDRESS, pendingEmail: HELD_ADDRESS });
      expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
        pendingEmail: HELD_ADDRESS,
        addressGeneration: 4,
      });
      expect(world.ledger.claims.get(HELD_ADDRESS)?.owner).toBe(owner);
      expect(world.codes.records.size).toBe(0);
      // The code is prepared all the same, so both answers cost the same.
      expect(world.counter.counted).toEqual([HELD_ADDRESS]);
      expect(await sentTo(world)).toEqual([[OLD_ADDRESS, REQUESTED_SUBJECT]]);
    },
  );

  it('answers the mail cap the same for a held address and a free one', async () => {
    addAccount(world, { id: OTHER_ID, email: HELD_ADDRESS });
    world.counter.full.add(HELD_ADDRESS);
    world.counter.full.add(NEW_ADDRESS);

    for (const address of [HELD_ADDRESS, NEW_ADDRESS]) {
      await expect(
        world.requests.request(world.caller(), address),
      ).rejects.toMatchObject({ code: ErrorCode.EMAIL_SEND_LIMIT_REACHED });
    }
    expect(world.accounts.row(ACCOUNT_ID).pendingEmail).toBeUndefined();
    expect(await world.sent()).toEqual([]);
  });

  it('runs the statements of a free address for a held one, so the time an answer takes tells nothing', async () => {
    const held = ownEmailWorld();
    addAccount(held, { id: OTHER_ID, email: HELD_ADDRESS });
    const claimed = ownEmailWorld();
    claimed.ledger.claims.set(HELD_ADDRESS, {
      address: HELD_ADDRESS,
      owner: OTHER_ID,
      kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
      lapsesAt: new Date('2099-01-02T00:00:00.000Z'),
    });

    const free = await statementsOf(world, NEW_ADDRESS);

    expect(free).toEqual([
      'claims read',
      'claims write',
      'codes write',
      'users read',
      'users read',
    ]);
    expect(await statementsOf(held, HELD_ADDRESS)).toEqual(free);
    expect(await statementsOf(claimed, HELD_ADDRESS)).toEqual(free);
  });

  it('rolls back a claim lost to another request and stores the request as held', async () => {
    // isFree said free, then an account took the address before the claim.
    class RacingLedger extends MemoryLedger {
      isFree(): Promise<boolean> {
        return Promise.resolve(true);
      }
    }
    const racing = ownEmailWorld({
      ledger: (accounts) => new RacingLedger(accounts),
    });
    addAccount(racing, { id: OTHER_ID, email: HELD_ADDRESS });

    const state = await racing.requests.request(racing.caller(), HELD_ADDRESS);

    expect(state).toEqual({ email: OLD_ADDRESS, pendingEmail: HELD_ADDRESS });
    expect(racing.accounts.row(ACCOUNT_ID).pendingEmail).toBe(HELD_ADDRESS);
    expect(racing.ledger.claims.size).toBe(0);
    expect(racing.codes.records.size).toBe(0);
    expect(await sentTo(racing)).toEqual([[OLD_ADDRESS, REQUESTED_SUBJECT]]);
  });

  it('refuses a request whose address generation moved after it was read, and stores nothing', async () => {
    // A staff change commits between the read and the request's own work.
    const read = world.accounts.readMovedAccount.bind(world.accounts);
    jest
      .spyOn(world.accounts, 'readMovedAccount')
      .mockImplementationOnce((unitOfWork, userId) => {
        world.accounts.row(userId).addressGeneration += 1;
        return read(unitOfWork, userId);
      });

    await expect(
      world.requests.request(world.caller(), NEW_ADDRESS),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(world.ledger.claims.size).toBe(0);
    expect(world.codes.records.size).toBe(0);
    expect(world.accounts.row(ACCOUNT_ID).pendingEmail).toBeUndefined();
  });

  it('refuses a request whose session ended while it was prepared, and stores nothing', async () => {
    // A confirm on another device ends this session; the generation stays.
    const read = world.accounts.readMovedAccount.bind(world.accounts);
    jest
      .spyOn(world.accounts, 'readMovedAccount')
      .mockImplementationOnce((unitOfWork, userId) => {
        world.sessions.live.set(userId, { ids: [OTHER_SESSION] });
        return read(unitOfWork, userId);
      });

    await expect(
      world.requests.request(world.caller(), NEW_ADDRESS),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });

    expect(world.accounts.row(ACCOUNT_ID).pendingEmail).toBeUndefined();
    expect(world.ledger.claims.size).toBe(0);
    expect(world.codes.records.size).toBe(0);
    expect(await world.sent()).toEqual([]);
  });

  it('replaces an earlier request: the next generation, and the first address freed', async () => {
    await world.requests.request(world.caller(), NEW_ADDRESS);
    await world.requests.request(world.caller(), 'second@example.test');

    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      pendingEmail: 'second@example.test',
      addressGeneration: 5,
    });
    expect(world.ledger.claims.has(NEW_ADDRESS)).toBe(false);
    expect(world.ledger.claims.get('second@example.test')?.owner).toBe(
      ACCOUNT_ID,
    );
  });

  it('cancels a pending change: the address is freed and the generation moves on', async () => {
    await world.requests.request(world.caller(), NEW_ADDRESS);

    const state = await world.requests.cancel(world.caller());

    expect(state).toEqual({ email: OLD_ADDRESS });
    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      pendingEmail: undefined,
      addressGeneration: 5,
    });
    expect(world.ledger.claims.size).toBe(0);
  });

  it('refuses to cancel without a fresh proof, so an idle session cannot undo a change staff started', async () => {
    await world.startStaffChange(NEW_ADDRESS);

    await expect(world.requests.cancel(world.caller(6))).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });

    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      pendingEmail: NEW_ADDRESS,
      addressGeneration: 4,
    });
    expect(world.ledger.claims.get(NEW_ADDRESS)?.owner).toBe(ACCOUNT_ID);
  });
});
