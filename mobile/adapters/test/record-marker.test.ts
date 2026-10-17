import { describe, expect, it } from 'vitest';
import { createDeferredLaunchFilter } from '../src/logic/launch-address';
import { writeConditionFromError } from '../src/logic/secure-store-errors';
import { recordMarkerFile } from '../src/logic/storage-key';
import { createCredentialsPort } from '../src/ports/credentials';
import { FakeMarkerFile } from './support/fake-modules';
import { FakeSecureStore, keychainError } from './support/fake-store';

const KEY = 'auth.native-client.test';
const OPTIONS = { keychainAccessible: 4 } as const;
const LAUNCH = 'sampleapp://auth/callback?code=A&state=1';
const OTHER = 'sampleapp://auth/callback?code=B&state=2';

function setup() {
  const store = new FakeSecureStore();
  const marker = new FakeMarkerFile();
  const port = createCredentialsPort(store, KEY, OPTIONS, marker);
  return { store, marker, port };
}

describe('the marker kept beside the credential record', () => {
  it('is written with the record and removed with it', async () => {
    const { marker, port } = setup();

    expect(await port.replace('record')).toEqual({ kind: 'done' });
    expect(marker.present).toBe(true);
    expect(await port.replace('next')).toEqual({ kind: 'done' });
    expect(marker.present).toBe(true);
    expect(await port.delete()).toEqual({ kind: 'done' });
    expect(marker.present).toBe(false);
    expect(await port.delete()).toEqual({ kind: 'done' });
  });

  it('reads a record the platform dropped as corrupt, and as missing after a delete', async () => {
    const { store, port } = setup();
    await port.replace('record');
    store.discard(KEY);

    expect(await port.read()).toEqual({ kind: 'corrupt' });
    expect(await port.delete()).toEqual({ kind: 'done' });
    expect(await port.read()).toEqual({ kind: 'missing' });
  });

  it('does not report missing when the record is gone and the marker cannot be read', async () => {
    const { store, marker, port } = setup();
    await port.replace('record');
    store.discard(KEY);
    marker.unreadable = true;

    expect(await port.read()).toEqual({ kind: 'unavailable' });
  });

  it('saves the record even when the marker cannot be written', async () => {
    const { store, marker, port } = setup();
    marker.readOnly = true;

    expect(await port.replace('record')).toEqual({ kind: 'done' });
    expect(store.items.get(KEY)).toBe('record');
    expect(await port.read()).toEqual({ kind: 'found', value: 'record' });
  });

  it('deletes the record even when the marker cannot be removed, and then reads corrupt', async () => {
    const { store, marker, port } = setup();
    await port.replace('record');
    marker.readOnly = true;

    expect(await port.delete()).toEqual({ kind: 'done' });
    expect(store.items.has(KEY)).toBe(false);
    expect(await port.read()).toEqual({ kind: 'corrupt' });
  });
});

describe('a write the keychain refuses', () => {
  it.each([
    ['User interaction is not allowed.', 'locked'],
    ['User canceled the operation.', 'cancelled'],
    ['No keychain is available. You may need to restart your computer.', 'unavailable'],
  ])('answers the reason "%s" as %s and changes nothing', async (reason, kind) => {
    const { store, marker, port } = setup();
    await port.replace('record');
    store.writeFailure = reason;

    expect(await port.replace('next')).toEqual({ kind });
    expect(await port.delete()).toEqual({ kind });
    expect(store.items.get(KEY)).toBe('record');
    expect(marker.present).toBe(true);
  });

  it('does not mark a record that was never written', async () => {
    const { store, marker, port } = setup();
    store.writeFailure = 'User interaction is not allowed.';

    expect(await port.replace('record')).toEqual({ kind: 'locked' });
    expect(marker.present).toBe(false);
    store.writeFailure = undefined;
    expect(await port.read()).toEqual({ kind: 'missing' });
  });

  it('reads a decode failure during a write as unavailable', () => {
    const decode = keychainError('Unable to decode the provided data.', 'setValueWithKeyAsync');

    expect(writeConditionFromError(decode)).toBe('unavailable');
    expect(writeConditionFromError(new Error('User canceled the operation.'))).toBe('cancelled');
  });
});

describe('the marker file name', () => {
  it('follows the record key, so two builds never share a marker', () => {
    expect(recordMarkerFile('com.example.mobile', 'staging')).toBe(
      'auth.com_002eexample_002emobile.staging.marker',
    );
    expect(recordMarkerFile('com.example.mobile', 'production')).toBe(
      'auth.com_002eexample_002emobile.production.marker',
    );
  });
});

describe('launch address filter while the address is not known yet', () => {
  it('admits events and has nothing to hand over before it learns the address', () => {
    const filter = createDeferredLaunchFilter();

    expect(filter.takeLaunch()).toBeUndefined();
    expect(filter.admitEvent(LAUNCH)).toBe(true);
    expect(filter.admitEvent(LAUNCH)).toBe(true);
  });

  it('counts a first event that carried the launch address as the hand-over', () => {
    const filter = createDeferredLaunchFilter();
    filter.admitEvent(LAUNCH);

    filter.learn(LAUNCH);

    expect(filter.takeLaunch()).toBeUndefined();
    expect(filter.admitEvent(LAUNCH)).toBe(true);
  });

  it('keeps the launch address for the read when the first event was another link', () => {
    const filter = createDeferredLaunchFilter();
    filter.admitEvent(OTHER);

    filter.learn(LAUNCH);

    expect(filter.takeLaunch()).toBe(LAUNCH);
  });

  it('behaves like a known address once it learned one before any event', () => {
    const filter = createDeferredLaunchFilter();
    filter.learn(LAUNCH);

    expect(filter.takeLaunch()).toBe(LAUNCH);
    expect(filter.admitEvent(LAUNCH)).toBe(false);
    expect(filter.admitEvent(LAUNCH)).toBe(true);
  });
});
