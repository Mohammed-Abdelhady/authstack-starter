import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createDeviceKey } from '../src';
import {
  ALIAS,
  nodeVerifies,
  DEVICES,
  SETTINGS,
  SOFTWARE_ALIAS,
  storedPublicJwk,
  subject,
  valueOf,
} from './subject';
import { fixedKey } from './node-keys';

const DATA = new Uint8Array(Buffer.from('header.payload'));

describe.each(DEVICES)('device key on $platform with $hardware', (device) => {
  it('creates the key on first use and marks that it did', async () => {
    const { native, key } = subject(device);

    const result = await key.publicKey();

    expect(result).toEqual({ kind: 'success', value: storedPublicJwk(native, ALIAS) });
    expect(native.count('generateKeyAsync')).toBe(1);
    expect([...native.markers]).toEqual([ALIAS]);
  });

  it('reads the key an earlier app start created and makes no new one', async () => {
    const { native, key } = subject(device);
    native.install(ALIAS, fixedKey(device.platform), device.hardware);
    native.markers.add(ALIAS);

    const result = await key.publicKey();

    expect(result).toEqual({
      kind: 'success',
      value: {
        kty: 'EC',
        crv: 'P-256',
        x: 'kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394',
        y: 'Dhwd2dUIhY_-YTgJDQNh7VMP7CMF7LhiwZAwaFo17BM',
        alg: 'ES256',
      },
    });
    expect(native.count('generateKeyAsync')).toBe(0);
  });

  it('signs with a 64-byte signature Node verifies against the public key', async () => {
    const { key } = subject(device);
    const jwk = valueOf(await key.publicKey());

    const signature = valueOf(await key.sign(DATA));

    expect(signature).toHaveLength(64);
    expect(nodeVerifies(jwk, DATA, signature)).toBe(true);
    expect(nodeVerifies(jwk, new Uint8Array(Buffer.from('header.other')), signature)).toBe(false);
  });

  it('says how the key is protected', async () => {
    const { key } = subject(device);

    expect(await key.prepare()).toEqual({ kind: 'ready', protection: device.hardware });
  });
});

describe('device key lifecycle', () => {
  it('creates one key when two first uses overlap', async () => {
    const { native, key } = subject();
    const release = native.hold('generateKeyAsync');

    const both = Promise.all([key.publicKey(), key.publicKey()]);
    release();
    const [first, second] = await both;

    expect(native.count('generateKeyAsync')).toBe(1);
    expect(second).toEqual(first);
    expect(first).toEqual({ kind: 'success', value: storedPublicJwk(native, ALIAS) });
  });

  it('takes over a key that has no marker, as after an iOS reinstall', async () => {
    const { native, key } = subject();
    native.install(ALIAS, fixedKey('ios'), 'secureEnclave');

    const jwk = valueOf(await key.publicKey());

    expect(jwk.x).toBe('kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394');
    expect(native.count('generateKeyAsync')).toBe(0);
    expect([...native.markers]).toEqual([ALIAS]);
  });

  it('gives two environments and two clients separate keys', async () => {
    const { native, key } = subject();
    const production = createDeviceKey(native, { ...SETTINGS, environment: 'production' });
    const otherClient = createDeviceKey(native, { ...SETTINGS, clientId: 'other-client' });

    const keys = [
      valueOf(await key.publicKey()),
      valueOf(await production.publicKey()),
      valueOf(await otherClient.publicKey()),
    ];

    expect([...native.keys.keys()]).toEqual([
      ALIAS,
      'devicekey.hw.native-client.production',
      'devicekey.hw.other-client.development',
    ]);
    expect(new Set(keys.map(({ x }) => x)).size).toBe(3);
    expect(valueOf(await key.publicKey())).toEqual(keys[0]);
  });

  it('deletes the key on request and starts clean on the next use', async () => {
    const { native, key } = subject();
    const before = valueOf(await key.publicKey());

    expect(await key.delete()).toEqual({ kind: 'deleted' });
    expect([...native.keys.keys()]).toEqual([]);
    expect([...native.markers]).toEqual([]);

    const after = valueOf(await key.publicKey());
    expect(after).toEqual(storedPublicJwk(native, ALIAS));
    expect(after.x).not.toBe(before.x);
  });

  it('reports a delete the system refused and keeps the key', async () => {
    const { native, key } = subject();
    await key.publicKey();
    native.failNext('deleteKeyAsync');

    expect(await key.delete()).toEqual({ kind: 'unavailable' });
    expect([...native.keys.keys()]).toEqual([ALIAS]);
  });

  it('deletes without complaint when there is no key', async () => {
    const { key } = subject();

    expect(await key.delete()).toEqual({ kind: 'deleted' });
  });
});

describe('device key without secure hardware', () => {
  const NO_HARDWARE = { platform: 'android', hardware: 'none' } as const;

  it('refuses to make a key when hardware is required', async () => {
    const { native, key } = subject(NO_HARDWARE);

    expect(await key.prepare()).toEqual({ kind: 'noSecureHardware' });
    expect(await key.publicKey()).toEqual({ kind: 'unavailable' });
    expect([...native.keys.keys()]).toEqual([]);
    expect([...native.markers]).toEqual([]);
  });

  it('makes a software key only when the shell allowed one, under its own name', async () => {
    const { native, key } = subject(NO_HARDWARE, { protection: 'softwareAllowed' });

    expect(await key.prepare()).toEqual({ kind: 'ready', protection: 'software' });
    expect([...native.keys.keys()]).toEqual([SOFTWARE_ALIAS]);
    const signature = valueOf(await key.sign(DATA));
    expect(nodeVerifies(storedPublicJwk(native, SOFTWARE_ALIAS), DATA, signature)).toBe(true);
  });

  it('asks for hardware first even when software is allowed', async () => {
    const { key } = subject(
      { platform: 'android', hardware: 'strongBox' },
      { protection: 'softwareAllowed' },
    );

    expect(await key.prepare()).toEqual({ kind: 'ready', protection: 'strongBox' });
  });

  it('drops a software key the native side returned where hardware is required', async () => {
    const { native, key } = subject();
    native.install(ALIAS, fixedKey('ios'), 'software');
    native.markers.add(ALIAS);

    expect(await key.prepare()).toEqual({ kind: 'noSecureHardware' });
    expect([...native.keys.keys()]).toEqual([]);
    expect([...native.markers]).toEqual([]);
  });
});
