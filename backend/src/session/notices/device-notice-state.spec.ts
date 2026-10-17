import { rememberDevice } from './device-notice-state';
import type { RememberedDevices } from './types/device-notice';

const NOW = new Date('2026-10-17T23:59:59.000Z');

describe('new device notice limits', () => {
  it('remembers the first sign-in without sending and suppresses its repeat', () => {
    const first = rememberDevice({
      devices: null,
      key: 'install-a',
      at: NOW,
      signIns: 1,
    });
    expect(first).toEqual({
      devices: {
        keys: ['install-a'],
        day: '2026-10-17',
        count: 0,
        firstAuthenticatedAt: '2026-10-17T23:59:59.000Z',
      },
      notify: false,
    });
    expect(
      rememberDevice({
        devices: first.devices,
        key: 'install-a',
        at: NOW,
        signIns: 2,
      }).notify,
    ).toBe(false);
    expect(
      rememberDevice({
        devices: first.devices,
        key: 'install-b',
        at: NOW,
        signIns: 2,
      }).notify,
    ).toBe(true);
  });

  it('skips the first browser-to-native journey and first enrollment promotion', () => {
    const first = rememberDevice({
      devices: null,
      key: 'browser',
      at: NOW,
      signIns: 1,
    });
    const native = rememberDevice({
      devices: first.devices,
      key: 'native',
      at: new Date('2026-10-18T00:00:00Z'),
      signIns: 2,
      authenticatedAt: NOW,
    });
    expect(native.notify).toBe(false);
    expect(
      rememberDevice({
        devices: native.devices,
        key: 'second-native',
        at: new Date('2026-10-18T00:00:01Z'),
        signIns: 3,
        authenticatedAt: NOW,
      }).notify,
    ).toBe(true);
    expect(
      rememberDevice({
        devices: first.devices,
        key: 'delayed-native',
        at: new Date('2026-10-18T00:00:59Z'),
        signIns: 2,
        authenticatedAt: NOW,
      }).notify,
    ).toBe(true);
    expect(
      rememberDevice({
        devices: native.devices,
        key: 'another-native',
        at: new Date('2026-10-18T00:01:00Z'),
        signIns: 3,
        authenticatedAt: new Date('2026-10-18T00:01:00Z'),
      }).notify,
    ).toBe(true);
    expect(
      rememberDevice({ devices: null, key: 'promoted', at: NOW, signIns: 2 })
        .notify,
    ).toBe(false);
  });

  it('keeps the newest twenty devices and sends at most three notices per UTC day', () => {
    let devices: RememberedDevices | null = null;
    let notices = 0;
    for (let index = 0; index < 100; index += 1) {
      const result = rememberDevice({
        devices,
        key: `install-${index}`,
        at: NOW,
        signIns: index + 1,
      });
      devices = result.devices;
      notices += Number(result.notify);
    }
    expect(notices).toBe(3);
    expect(devices?.keys).toEqual([
      'install-80',
      'install-81',
      'install-82',
      'install-83',
      'install-84',
      'install-85',
      'install-86',
      'install-87',
      'install-88',
      'install-89',
      'install-90',
      'install-91',
      'install-92',
      'install-93',
      'install-94',
      'install-95',
      'install-96',
      'install-97',
      'install-98',
      'install-99',
    ]);
    const next = rememberDevice({
      devices,
      key: 'install-100',
      at: new Date('2026-10-18T00:00:00Z'),
      signIns: 101,
    });
    expect({
      notify: next.notify,
      day: next.devices.day,
      count: next.devices.count,
    }).toEqual({ notify: true, day: '2026-10-18', count: 1 });
  });
});
