import { describe, expect, it } from 'vitest';
import { createLaunchAddressFilter } from '../src/logic/launch-address';
import { createMonotonicReader } from '../src/logic/monotonic';
import { storageKey } from '../src/logic/storage-key';

const LAUNCH = 'sampleapp://auth/callback?code=A&state=1';
const OTHER = 'sampleapp://auth/callback?code=B&state=2';

describe('launch address handed over once', () => {
  it('gives the launch address to the first read only', () => {
    const filter = createLaunchAddressFilter(LAUNCH);

    expect(filter.takeLaunch()).toBe(LAUNCH);
    expect(filter.takeLaunch()).toBeUndefined();
  });

  it('lets the event carry the launch address when it comes before the read', () => {
    const filter = createLaunchAddressFilter(LAUNCH);

    expect(filter.admitEvent(LAUNCH)).toBe(true);
    expect(filter.takeLaunch()).toBeUndefined();
  });

  it('treats only the first event as a possible repeat', () => {
    const filter = createLaunchAddressFilter(LAUNCH);
    filter.takeLaunch();

    expect(filter.admitEvent(LAUNCH)).toBe(false);
    expect(filter.admitEvent(LAUNCH)).toBe(true);
  });

  it('keeps the launch address for the read when a different link comes first', () => {
    const filter = createLaunchAddressFilter(LAUNCH);

    expect(filter.admitEvent(OTHER)).toBe(true);
    expect(filter.takeLaunch()).toBe(LAUNCH);
    expect(filter.admitEvent(LAUNCH)).toBe(true);
  });

  it('admits every event of an app that started without a link', () => {
    const filter = createLaunchAddressFilter(undefined);

    expect(filter.takeLaunch()).toBeUndefined();
    expect(filter.admitEvent(LAUNCH)).toBe(true);
    expect(filter.admitEvent(LAUNCH)).toBe(true);
  });
});

describe('monotonic reader', () => {
  function readerOver(readings: number[]): () => number {
    let index = 0;
    return createMonotonicReader(() => readings[index++] ?? Number.NaN);
  }

  it('passes rising readings through and holds the highest when the source drops', () => {
    const read = readerOver([10, 10.5, 4, 10.5, 12]);

    expect([read(), read(), read(), read(), read()]).toEqual([10, 10.5, 10.5, 10.5, 12]);
  });

  it('keeps the last reading when the source stops giving numbers', () => {
    const read = readerOver([7, Number.NaN, Number.POSITIVE_INFINITY, 8]);

    expect([read(), read(), read(), read()]).toEqual([7, 7, 7, 8]);
  });

  it('shows a source that never gave a number as broken', () => {
    const read = readerOver([Number.NaN]);

    expect(read()).toBeNaN();
  });

  it('accepts zero and negative first readings', () => {
    expect(readerOver([0])()).toBe(0);
    expect(readerOver([-5])()).toBe(-5);
  });
});

describe('storage key', () => {
  it('joins plain parts with dots', () => {
    expect(storageKey('auth', 'native-client', 'development')).toBe(
      'auth.native-client.development',
    );
  });

  it('escapes characters the secure store refuses or that would blur two parts', () => {
    expect(storageKey('auth', 'com.example.mobile', 'dev_1')).toBe(
      'auth.com_002eexample_002emobile.dev_005f1',
    );
    expect(storageKey('auth', 'a b/é', '')).toBe('auth.a_0020b_002f_00e9.');
  });

  it('gives different parts different keys', () => {
    expect(storageKey('auth', 'a.b', 'c')).toBe('auth.a_002eb.c');
    expect(storageKey('auth', 'a', 'b.c')).toBe('auth.a.b_002ec');
  });

  it('returns the prefix alone when there are no parts', () => {
    expect(storageKey('auth')).toBe('auth');
  });
});
