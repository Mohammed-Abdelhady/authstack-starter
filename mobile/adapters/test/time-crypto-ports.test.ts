import { describe, expect, it } from 'vitest';
import { createClockPort } from '../src/ports/clock';
import { createCryptoPort } from '../src/ports/crypto';
import { createTimerPort } from '../src/ports/timer';
import { FAKE_SHA256, FakeCrypto, FakeTime } from './support/fake-modules';

/** SHA-256 of the ASCII bytes of "abc", from FIPS 180-2. */
const ABC_DIGEST_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('clock adapter', () => {
  it('keeps elapsed time still when the person moves the wall clock', () => {
    const time = new FakeTime();
    const clock = createClockPort(time);
    time.advance(5000);
    time.wallOffset = -3_600_000;

    expect(clock.wallTime()).toBe(1_799_996_405_000);
    expect(clock.monotonicTime()).toBe(5000);
  });

  it('never reports less elapsed time than before', () => {
    const time = new FakeTime();
    const clock = createClockPort(time);
    time.elapsed = 900;
    clock.monotonicTime();
    time.elapsed = 400;

    expect(clock.monotonicTime()).toBe(900);
  });
});

describe('timer adapter', () => {
  it('removes the platform timer on cancel', () => {
    const time = new FakeTime();
    let calls = 0;
    const cancel = createTimerPort(time).after(200, () => {
      calls += 1;
    });

    cancel();
    cancel();
    time.advance(500);

    expect(calls).toBe(0);
    expect(time.pendingTimers).toBe(0);
  });

  it('leaves a later timer alone when one that already fired is cancelled', () => {
    const time = new FakeTime();
    const timer = createTimerPort(time);
    let later = 0;
    const cancelFirst = timer.after(100, () => undefined);
    time.advance(100);
    timer.after(100, () => {
      later += 1;
    });

    cancelFirst();
    time.advance(100);

    expect(later).toBe(1);
  });
});

describe('crypto adapter', () => {
  it('hashes exactly the bytes it was given when they sit inside a larger buffer', async () => {
    const whole = Uint8Array.from([0, 97, 98, 99, 0]);
    const port = createCryptoPort(new FakeCrypto(), FAKE_SHA256);

    expect(hex(await port.sha256(whole.subarray(1, 4)))).toBe(ABC_DIGEST_HEX);
  });

  it('rejects when the module is asked for an algorithm it does not have', async () => {
    const port = createCryptoPort(new FakeCrypto(), 'SHA-1');

    await expect(port.sha256(Uint8Array.from([1]))).rejects.toThrow('Invalid algorithm');
  });

  it('rejects a digest that is not 32 bytes long', async () => {
    const crypto = new FakeCrypto();
    crypto.digest = async () => new ArrayBuffer(20);

    await expect(
      createCryptoPort(crypto, FAKE_SHA256).sha256(Uint8Array.from([1])),
    ).rejects.toThrow('The digest is not 32 bytes long.');
  });

  it('rejects when the random source returns fewer bytes than asked', async () => {
    const crypto = new FakeCrypto();
    crypto.getRandomBytesAsync = async (count) => new Uint8Array(count - 1);

    await expect(createCryptoPort(crypto, FAKE_SHA256).randomBytes(16)).rejects.toThrow(
      'The random source returned the wrong number of bytes.',
    );
  });
});
