import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmWithAlert } from '../../src/components/confirm';
import { useEngineSnapshot } from '../../src/hooks/use-engine-snapshot';
import { useForegroundRestore } from '../../src/hooks/use-foreground-restore';
import { useReducedMotion } from '../../src/hooks/use-reduced-motion';
import { useRoute } from '../../src/hooks/use-route';
import type { EnginePort } from '../../src/types';
import { createFakeEngine, signedInAs, SIGNED_OUT } from '../support/fake-engine';
import { createFakeServer } from '../support/fake-server';
import { renderHook } from '../support/hook';
import { device } from '../support/react-native';
import { cleanup, flush, unmountAll } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

describe('the route hook', () => {
  it('moves forward to the devices screen and back with the system back button', () => {
    const route = renderHook(useRoute);

    act(() => route.current().openSessions());
    expect({ route: route.current().route, arrival: route.current().arrival }).toEqual({
      route: 'sessions',
      arrival: 'forward',
    });

    let handled = false;
    act(() => {
      handled = device.pressBack();
    });
    expect({ handled, route: route.current().route, arrival: route.current().arrival }).toEqual({
      handled: true,
      route: 'account',
      arrival: 'back',
    });
    expect(device.listenerCount()).toBe(0);
  });

  it('stops handling the back button when the screens are taken away mid-route', () => {
    const route = renderHook(useRoute);
    act(() => route.current().openSessions());

    unmountAll();

    expect(device.pressBack()).toBe(false);
  });
});

describe('restoring in the foreground', () => {
  it('restores on mount and each time the app becomes active, and at no other change', () => {
    const restore = vi.fn();
    renderHook(() => useForegroundRestore(restore));

    device.appStateChanged('inactive');
    device.appStateChanged('background');
    expect(restore).toHaveBeenCalledTimes(1);

    device.appStateChanged('active');
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('stops restoring once it is unmounted', () => {
    const restore = vi.fn();
    renderHook(() => useForegroundRestore(restore));

    unmountAll();
    device.appStateChanged('active');

    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe('the reduced-motion hook', () => {
  it('keeps motion off until the setting has been read, then follows the system', async () => {
    device.reduceMotion = false;
    const reduced = renderHook(useReducedMotion);
    expect(reduced.current()).toBe(true);

    await flush();
    expect(reduced.current()).toBe(false);

    act(() => device.reduceMotionChanged(true));
    expect(reduced.current()).toBe(true);
  });

  it('ignores a setting that arrives after it is unmounted', async () => {
    device.reduceMotion = false;
    const reduced = renderHook(useReducedMotion);

    unmountAll();
    await flush();

    expect({ value: reduced.current(), listeners: device.listenerCount() }).toEqual({
      value: true,
      listeners: 0,
    });
  });
});

describe('the engine snapshot hook', () => {
  it('follows what the engine publishes, and stops listening when it is unmounted', () => {
    const fake = createFakeEngine(createFakeServer().transport, SIGNED_OUT);
    let listening = 0;
    const engine: EnginePort = {
      ...fake.engine,
      get snapshot() {
        return fake.engine.snapshot;
      },
      transport: fake.engine.transport,
      signIn: () => fake.engine.signIn(),
      signOut: () => fake.engine.signOut(),
      restore: () => fake.engine.restore(),
      subscribe(listener) {
        listening += 1;
        const stop = fake.engine.subscribe(listener);
        return () => {
          listening -= 1;
          stop();
        };
      },
    };
    const snapshot = renderHook(() => useEngineSnapshot(engine));
    expect({ status: snapshot.current().status, listening }).toEqual({
      status: 'signedOut',
      listening: 1,
    });

    act(() => fake.publish(signedInAs('ada')));
    expect(snapshot.current().status).toBe('signedIn');

    unmountAll();
    expect(listening).toBe(0);
  });
});

describe('the confirmation dialog', () => {
  const REQUEST = {
    title: 'Sign out Work laptop?',
    message: 'That device will need to sign in again.',
    confirmLabel: 'Sign out',
    cancelLabel: 'Cancel',
  };

  it.each([
    ['the destructive button', 1, true],
    ['the cancel button', 0, false],
  ] as const)('answers %s', async (_name, index, confirmed) => {
    const answer = confirmWithAlert(REQUEST);

    device.alerts[0]?.buttons[index]?.onPress?.();

    expect(await answer).toBe(confirmed);
  });

  it('answers no when the dialog is dismissed', async () => {
    const answer = confirmWithAlert(REQUEST);

    device.alerts[0]?.options.onDismiss?.();

    expect(await answer).toBe(false);
  });
});
