import { TEST_NOW } from '../../../test/utils/frozen-clock';
import type { EmailCodeHarness } from './email-code.harness-spec';
import { EMAIL_CODE_PURPOSE, type EmailCodeKey } from './email-code.store';

const KEY: EmailCodeKey = {
  ownerId: 'browser:web:nonce-hash',
  purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
};
const DELIVERY = {
  pendingHash: 'pending:opaque-generation',
  codeHash: 'delivered-code-hash',
  limit: 5,
};
const LIFETIME_MS = 600_000;

export function emailCodeDeliveryCases(current: () => EmailCodeHarness): void {
  async function pending(
    key = KEY,
    pendingHash = DELIVERY.pendingHash,
  ): Promise<void> {
    await current().store.put({
      ...key,
      email: 'mail@example.test',
      codeHash: pendingHash,
      expiresAt: new Date(TEST_NOW.getTime() + LIFETIME_MS),
      purgeAfter: new Date(TEST_NOW.getTime() + LIFETIME_MS),
      spent: true,
    });
  }
  function deliver(key = KEY, delivery = DELIVERY): Promise<boolean> {
    return current().unitOfWork.run((work) =>
      current().store.deliverIn(work, key, delivery),
    );
  }
  function spend(): Promise<boolean> {
    return current().unitOfWork.run((work) =>
      current().store.spendIn(work, KEY, {
        codeHash: DELIVERY.codeHash,
        limit: 5,
      }),
    );
  }

  it('keeps pending delivery unspendable, then delivers once without reviving it after consumption at the same clock instant', async () => {
    await pending();
    expect(await spend()).toBe(false);
    expect(await deliver()).toBe(true);
    expect(await current().store.find(KEY)).toMatchObject({
      codeHash: 'delivered-code-hash',
      spentAt: null,
    });
    expect(await spend()).toBe(true);
    expect(await deliver()).toBe(false);
    expect(await spend()).toBe(false);
    expect(await current().store.find(KEY)).toMatchObject({
      codeHash: 'delivered-code-hash',
      spentAt: TEST_NOW,
    });
  });

  it('cannot deliver a cancelled generation or let an old cancellation kill its replacement', async () => {
    await pending();
    expect(
      await current().unitOfWork.run((work) =>
        current().store.cancelIn(work, KEY, DELIVERY.pendingHash),
      ),
    ).toBe(true);
    expect(await deliver()).toBe(false);
    await pending(KEY, 'pending:new-generation');
    expect(
      await current().unitOfWork.run((work) =>
        current().store.cancelIn(work, KEY, DELIVERY.pendingHash),
      ),
    ).toBe(false);
    expect(await deliver()).toBe(false);
    expect(
      await deliver(KEY, {
        ...DELIVERY,
        pendingHash: 'pending:new-generation',
      }),
    ).toBe(true);
    expect(await spend()).toBe(true);
  });

  it('reads and cancels the current delivered generation together when a prior pending snapshot became stale', async () => {
    await pending();
    const earlier = await current().store.find(KEY);
    expect(earlier?.codeHash).toBe('pending:opaque-generation');
    expect(await deliver()).toBe(true);
    await current().unitOfWork.run(async (work) => {
      const actual = await current().store.findIn(work, KEY);
      expect(actual?.codeHash).toBe('delivered-code-hash');
      if (!actual) throw new Error('No current code generation');
      expect(await current().store.cancelIn(work, KEY, actual.codeHash)).toBe(
        true,
      );
    });
    expect(await spend()).toBe(false);
    expect(await deliver()).toBe(false);
    expect((await current().store.find(KEY))?.codeHash).toBe('');
  });

  it('binds pending activation to exact owner, purpose, hash, expiry and guess budget', async () => {
    await pending();
    expect(await deliver({ ...KEY, ownerId: 'browser:admin:nonce-hash' })).toBe(
      false,
    );
    expect(
      await deliver({ ...KEY, purpose: EMAIL_CODE_PURPOSE.ADDRESS_GUESSES }),
    ).toBe(false);
    expect(
      await deliver(KEY, { ...DELIVERY, pendingHash: 'pending:other' }),
    ).toBe(false);
    expect(
      await deliver(KEY, { ...DELIVERY, codeHash: DELIVERY.pendingHash }),
    ).toBe(false);
    for (let guess = 1; guess <= 4; guess += 1)
      await current().store.recordWrongGuess(KEY, 5);
    expect(await deliver()).toBe(true);
    await pending(KEY, 'pending:final-guess');
    await current().store.recordWrongGuess(KEY, 5);
    expect(
      await deliver(KEY, { ...DELIVERY, pendingHash: 'pending:final-guess' }),
    ).toBe(false);
    const other = { ...KEY, ownerId: 'browser:web:expired' };
    await pending(other);
    current().clock.advance(LIFETIME_MS);
    expect(await deliver(other)).toBe(false);
  });

  it('activates once under concurrent completion and rolls activation back with its unit of work', async () => {
    await pending();
    await expect(
      current().unitOfWork.run(async (work) => {
        expect(await current().store.deliverIn(work, KEY, DELIVERY)).toBe(true);
        throw new Error('delivery transaction refused');
      }),
    ).rejects.toThrow('delivery transaction refused');
    expect(await current().store.find(KEY)).toMatchObject({
      codeHash: 'pending:opaque-generation',
      spentAt: TEST_NOW,
    });
    const completed = await Promise.all([deliver(), deliver()]);
    expect(completed.sort()).toEqual([false, true]);
    expect(await spend()).toBe(true);
  });
}
