import { ADDRESS_CLAIM_KIND } from '../../../src/common/persistence/address-ledger';
import { LedgerHarnessSource } from './address-ledger-harness';
import {
  ADDRESS,
  AddressTaken,
  claim,
  claimInput,
  FIRST_OWNER,
  LAPSE_MS,
  SECOND_OWNER,
} from './address-ledger-support';

export function ledgerCases(current: LedgerHarnessSource): void {
  it.each(['owned', 'missing', 'lapsed', 'foreign'])(
    'locks only an existing live owned claim with state=%s',
    async (state) => {
      const h = current();
      if (state !== 'missing') await claim(h);
      if (state === 'owned') h.clock.advance(LAPSE_MS - 1);
      if (state === 'lapsed') h.clock.advance(LAPSE_MS);
      expect(
        await h.runner().run((uow) =>
          h.ledger.holdsLiveClaim(uow, {
            address: ' FOO@Example.COM ',
            owner: state === 'foreign' ? SECOND_OWNER : FIRST_OWNER,
            now: h.clock.now(),
          }),
        ),
      ).toBe(state === 'owned');
      expect(await h.claims()).toEqual(
        state === 'missing'
          ? []
          : [
              {
                address: ADDRESS,
                owner: FIRST_OWNER,
                kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
                lapsesAt: new Date('2099-01-01T12:01:00.000Z'),
              },
            ],
      );
    },
  );

  it('L3 blocks before lapse and permits takeover at the exact lapse', async () => {
    const h = current();
    await claim(h);
    h.clock.advance(LAPSE_MS - 1);
    expect(await claim(h, claimInput(h, SECOND_OWNER))).toBe('taken');
    h.clock.advance(1);
    expect(await claim(h, claimInput(h, SECOND_OWNER))).toBe('claimed');
    expect((await h.claims()).map((row) => row.owner)).toEqual([SECOND_OWNER]);
  });

  it('L5 normalises claim, availability, reservation and release', async () => {
    const h = current();
    await claim(h, claimInput(h, FIRST_OWNER, ' Foo@Example.COM '));
    expect(await claim(h, claimInput(h, SECOND_OWNER))).toBe('taken');
    expect(
      await h.runner().run((uow) =>
        h.ledger.isFree(uow, {
          address: ' FOO@EXAMPLE.COM ',
          now: h.clock.now(),
        }),
      ),
    ).toBe(false);
    await expect(
      h.runner().run(async (uow) => {
        const result = await h.ledger.reserveForAccount(uow, {
          address: ' Foo@Example.COM ',
          now: h.clock.now(),
        });
        expect(result.status).toBe('taken');
        throw new AddressTaken();
      }),
    ).rejects.toBeInstanceOf(AddressTaken);
    await h.runner().run((uow) =>
      h.ledger.release(uow, {
        address: ' Foo@Example.COM ',
        owner: FIRST_OWNER,
      }),
    );
    await h.runner().run(async (uow) => {
      const result = await h.ledger.reserveForAccount(uow, {
        address: ' Foo@Example.COM ',
        now: h.clock.now(),
      });
      if (result.status !== 'reserved') throw new Error('reservation refused');
      expect(result.reservation.address).toBe(ADDRESS);
      await h.ledger.finishAccountReservation(uow, result.reservation);
    });
    expect(await h.claims()).toEqual([]);
  });

  it.each([false, true])(
    'L6 includes an account with deleted=%s',
    async (deleted) => {
      const h = current();
      const owner = await h.seedAccount(ADDRESS, deleted);
      expect(
        await h.runner().run((uow) =>
          h.ledger.isFree(uow, {
            address: ADDRESS,
            now: h.clock.now(),
          }),
        ),
      ).toBe(false);
      expect(await claim(h)).toBe('taken');
      expect(await h.claims()).toEqual([]);
      expect(await claim(h, claimInput(h, owner))).toBe('claimed');
    },
  );

  it('L7 only the owner releases a claim', async () => {
    const h = current();
    await claim(h);
    await h.runner().run((uow) =>
      h.ledger.release(uow, {
        address: ADDRESS,
        owner: SECOND_OWNER,
      }),
    );
    expect((await h.claims()).map((row) => row.owner)).toEqual([FIRST_OWNER]);
    await h.runner().run((uow) =>
      h.ledger.release(uow, {
        address: ADDRESS,
        owner: FIRST_OWNER,
      }),
    );
    expect(
      await h.runner().run((uow) =>
        h.ledger.isFree(uow, {
          address: ADDRESS,
          now: h.clock.now(),
        }),
      ),
    ).toBe(true);
    expect(await h.claims()).toEqual([]);
  });

  it('refreshes the same owner and rolls back a refused takeover', async () => {
    const h = current();
    await claim(h);
    h.clock.advance(1);
    expect(await claim(h)).toBe('claimed');
    expect(await h.claims()).toEqual([
      {
        address: ADDRESS,
        owner: FIRST_OWNER,
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: new Date('2099-01-01T12:01:00.001Z'),
      },
    ]);
    await h.seedAccount(ADDRESS);
    h.clock.advance(LAPSE_MS);
    expect(await claim(h, claimInput(h, SECOND_OWNER))).toBe('taken');
    expect(await h.claims()).toEqual([
      {
        address: ADDRESS,
        owner: FIRST_OWNER,
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: new Date('2099-01-01T12:01:00.001Z'),
      },
    ]);
  });

  it('L14 replays an aborted body without a duplicate or self-conflict', async () => {
    const h = current();
    let attempts = 0;
    const result = await h
      .runner(() => Promise.resolve())
      .run(async (uow) => {
        attempts += 1;
        const claimed = await h.ledger.claim(uow, claimInput(h));
        if (attempts === 1) throw h.retryableAbort();
        return claimed;
      });
    expect(result).toBe('claimed');
    expect(attempts).toBe(2);
    expect((await h.claims()).map((row) => row.owner)).toEqual([FIRST_OWNER]);
  });
}
