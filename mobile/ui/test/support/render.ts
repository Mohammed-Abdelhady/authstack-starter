import type { AuthEngine, AuthSnapshot } from '@app/native-auth';
import { act, createElement, type ReactElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { vi } from 'vitest';
import { NativeApp } from '../../src/NativeApp';
import { translate, type Locale, type MessageArguments, type MessageKey } from '../../src/i18n';
import type { ConfirmRequest, EnginePort } from '../../src/types';
import { createFakeEngine, deferred, type Deferred, type FakeEngine } from './fake-engine';
import { createFakeServer, settle, type FakeServer } from './fake-server';
import { device, HOST } from './react-native';

// React checks both: state changes outside `act` are reported, and the renderer
// knows it is driving native views.
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  IS_REACT_NATIVE_TEST_ENVIRONMENT: true,
});

/** 08:02 UTC on the day the fake sessions were last used at 08:00, so they read as active now. */
export const NOW = Date.parse('2026-06-10T08:02:00.000Z');
export const APP_NAME = 'Harbour';
const NO_INSETS = { top: 0, bottom: 0, start: 0, end: 0 };

/**
 * The store tells its subscribers about a change on the next frame. On a device
 * that is the display's frame callback. Here it is a timer the tests step by hand.
 */
const FRAME_MS = 16;
/** A change made in answer to one frame's news is itself told on the next. */
const FRAMES_PER_FLUSH = 3;

const mounted: ReactTestRenderer[] = [];

/** Takes every rendered tree off the screen, running each effect's own cleanup. */
export function unmountAll(): void {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
}

/** Unmounts everything a test rendered and returns the stand-in device to its start. */
export function cleanup(): void {
  unmountAll();
  device.reset();
  vi.useRealTimers();
}

/** Lets resolved promises run and applies the renders they cause. */
export async function flush(): Promise<void> {
  await act(async () => {
    await settle();
    for (let frame = 0; frame < FRAMES_PER_FLUSH; frame += 1) {
      vi.advanceTimersByTime(FRAME_MS);
      await settle();
    }
  });
}

export function render(element: ReactElement): ReactTestInstance {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) throw new Error('Nothing was rendered.');
  mounted.push(renderer);
  return renderer.root;
}

const isHost = (node: ReactTestInstance): boolean => typeof node.type === 'string';

/** Every native view with this `testID`. */
export function allByTestId(root: ReactTestInstance, testID: string): ReactTestInstance[] {
  return root.findAll((node) => isHost(node) && node.props.testID === testID);
}

export function byTestId(root: ReactTestInstance, testID: string): ReactTestInstance {
  const [found, ...rest] = allByTestId(root, testID);
  if (found === undefined || rest.length > 0) {
    throw new Error(
      `Expected one view with testID ${testID}, found ${rest.length + (found ? 1 : 0)}`,
    );
  }
  return found;
}

export const isShown = (root: ReactTestInstance, testID: string): boolean =>
  allByTestId(root, testID).length > 0;

export function byRole(root: ReactTestInstance, role: string): ReactTestInstance[] {
  return root.findAll((node) => isHost(node) && node.props.accessibilityRole === role);
}

/** The text a view holds, in reading order, one entry per text node. */
export function textsOf(node: ReactTestInstance): string[] {
  return node.children.flatMap((child) => (typeof child === 'string' ? [child] : textsOf(child)));
}

/** What a screen reader is told about a touchable. */
export function accessibilityOf(node: ReactTestInstance) {
  const { accessibilityRole, accessibilityLabel, accessibilityHint, accessibilityState } =
    node.props;
  return { accessibilityRole, accessibilityLabel, accessibilityHint, accessibilityState };
}

function call(node: ReactTestInstance, handler: string): void {
  const run = node.props[handler];
  if (typeof run !== 'function') throw new Error(`The view has no ${handler} handler.`);
  act(() => void run());
}

/** A touch. A disabled touchable ignores it, as the platform's does. */
export async function press(root: ReactTestInstance, testID: string): Promise<void> {
  const target = byTestId(root, testID);
  if (target.type !== HOST.PRESSABLE) throw new Error(`${testID} is not a touchable.`);
  if (target.props.disabled !== true) call(target, 'onPress');
  await flush();
}

export function refreshControl(root: ReactTestInstance): ReactTestInstance {
  const [control] = root.findAll((node) => node.type === HOST.REFRESH_CONTROL);
  if (control === undefined) throw new Error('The list has no refresh control.');
  return control;
}

export async function pullToRefresh(root: ReactTestInstance): Promise<void> {
  call(refreshControl(root), 'onRefresh');
  await flush();
}

export interface RecordedConfirm {
  asked: ConfirmRequest[];
  confirm(request: ConfirmRequest): Promise<boolean>;
  /** Answers the oldest question still open. */
  answer(confirmed: boolean): Promise<void>;
}

/** Stands in for the platform dialog and keeps what it was asked. */
export function recordConfirm(): RecordedConfirm {
  const open: Deferred<boolean>[] = [];
  const recorded: RecordedConfirm = {
    asked: [],
    confirm(request) {
      const answer = deferred<boolean>();
      open.push(answer);
      recorded.asked.push(request);
      return answer.promise;
    },
    async answer(confirmed) {
      const answer = open.shift();
      if (answer === undefined) throw new Error('No confirmation is waiting for an answer.');
      answer.resolve(confirmed);
      await flush();
    },
  };
  return recorded;
}

/** The whole engine interface over the screens' fake, so the real root component accepts it. */
export function asAuthEngine(port: EnginePort): AuthEngine {
  return {
    get snapshot() {
      return port.snapshot;
    },
    transport: port.transport,
    subscribe: (listener) => port.subscribe(listener),
    restore: () => port.restore(),
    signIn: () => port.signIn(),
    signOut: () => port.signOut(),
    refresh: () => Promise.resolve({ kind: 'notSignedIn' }),
    dispose: () => undefined,
  };
}

export interface App {
  root: ReactTestInstance;
  server: FakeServer;
  fake: FakeEngine;
  confirm: RecordedConfirm;
  t(key: MessageKey, values?: MessageArguments): string;
  /** The engine reports a new state, and the screens follow it. */
  publish(snapshot: AuthSnapshot): Promise<void>;
  /** Runs a step that settles requests or promises and applies what it causes. */
  step(run: () => void): Promise<void>;
}

interface AppOptions {
  locale?: Locale;
  /** Changes the fake engine before the screens mount. */
  prepare?(fake: FakeEngine): void;
}

/** Mounts the real root component over the real runtime, a fake engine and a held server. */
export async function renderApp(initial: AuthSnapshot, options: AppOptions = {}): Promise<App> {
  const locale = options.locale ?? 'en';
  const server = createFakeServer();
  const fake = createFakeEngine(server.transport, initial);
  options.prepare?.(fake);
  const confirm = recordConfirm();
  const root = render(
    createElement(NativeApp, {
      engine: asAuthEngine(fake.engine),
      appName: APP_NAME,
      locale,
      insets: NO_INSETS,
      now: () => NOW,
      confirm: confirm.confirm,
    }),
  );
  await flush();
  const step = async (run: () => void): Promise<void> => {
    act(run);
    await flush();
  };
  return {
    root,
    server,
    fake,
    confirm,
    t: (key, values) => translate(locale, key, values),
    publish: (snapshot) => step(() => fake.publish(snapshot)),
    step,
  };
}
