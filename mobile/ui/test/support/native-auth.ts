import {
  createAuthEngine,
  type AuthDependencies,
  type ProviderSignInPort,
  type PasskeyPort,
} from '@app/native-auth';
import {
  TransportError,
  type NativeMethods,
  type TransportRequest,
  type TransportResponse,
} from '@app/sdk';
import { act, createElement, useState, type ComponentType } from 'react';
import { NativeApp } from '../../src/NativeApp';
import { Button } from '../../src/components/Button';
import type { Locale } from '../../src/i18n';
import type { NativeProviderButtonProps } from '../../src/types/native-sign-in';
import { render, flush, byTestId, unmountAll } from './render';
import { CONFIG, ScriptedTransport, apiReply, testPorts } from '../../../auth/test/support/support';

export const METHODS: NativeMethods = {
  nativeEnabled: true,
  methods: { password: true, magicLink: true, passkeys: true, twoFactor: true, oauth: [] },
  capabilities: {
    password: true,
    emailLink: true,
    passkeys: true,
    registration: true,
    recovery: true,
  },
  providers: [],
};
export const ATTEMPT_ID = 'ui-attempt';
export const ATTEMPT_SECRET = 's'.repeat(43);
const engines: ReturnType<typeof createAuthEngine>[] = [];

export function disposeNativeApps() {
  for (const engine of engines.splice(0)) engine.dispose();
}

interface NativeAppOptions {
  providerButton?: ComponentType<NativeProviderButtonProps>;
  methods?: NativeMethods;
  methodsResponse?: () => Promise<TransportResponse>;
  providerSignIn?: ProviderSignInPort;
  passkeys?: PasskeyPort;
}
export async function nativeApp(locale: Locale = 'en', options: NativeAppOptions = {}) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
  let methods = options.methods ?? METHODS;
  let failMethods = false;
  const rawHandlers = new Map<string, (request: TransportRequest) => Promise<TransportResponse>>();
  const handlers = new Map<string, (request: TransportRequest) => Promise<unknown>>();
  transport.respond = async (request) => {
    const raw = rawHandlers.get(request.path);
    if (raw) return raw(request);
    if (request.path.startsWith('/api/auth/native/methods')) {
      if (failMethods) throw new TransportError();
      return options.methodsResponse ? options.methodsResponse() : apiReply(methods);
    }
    if (request.path === '/api/auth/native/attempts')
      return apiReply({
        attemptId: ATTEMPT_ID,
        attemptSecret: ATTEMPT_SECRET,
        providerNonceDigest: 'a'.repeat(64),
        stage: 'firstFactorRequired',
        expiresAt,
        factors: ['password', 'provider', 'passkey', 'emailLink'],
      });
    if (request.path.endsWith('/cancel'))
      return apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt, reason: 'cancelled' });
    const handler = handlers.get(request.path);
    if (!handler) throw new Error(`No native UI HTTP fixture for ${request.path}`);
    return apiReply(await handler(request));
  };
  const dependencies: AuthDependencies = {
    ...ports,
    passkeys: options.passkeys ?? {
      available: async () => true,
      authenticate: async () => ({ kind: 'cancelled' }),
    },
    providerSignIn: options.providerSignIn,
  };
  let engine = createAuthEngine(CONFIG, dependencies);
  engines.push(engine);
  let changeEngine: (value: ReturnType<typeof createAuthEngine>) => void = () => undefined;
  function Host() {
    const [current, setCurrent] = useState(engine);
    changeEngine = setCurrent;
    return createElement(NativeApp, {
      engine: current,
      appName: 'Harbour',
      locale,
      providerButton: options.providerButton,
      insets: { top: 0, bottom: 0, start: 0, end: 0 },
      now: () => ports.clock.wall,
    });
  }
  const mount = () => render(createElement(Host));
  let root = mount();
  await flush();
  return {
    get root() {
      return root;
    },
    transport,
    ports,
    get engine() {
      return engine;
    },
    async replaceEngine() {
      engine.dispose();
      engine = createAuthEngine(CONFIG, dependencies);
      engines.push(engine);
      act(() => changeEngine(engine));
      await flush();
    },
    async remount() {
      unmountAll();
      engine.dispose();
      engine = createAuthEngine(CONFIG, dependencies);
      engines.push(engine);
      root = mount();
      await flush();
    },
    expiresAt,
    failMethods(value: boolean) {
      failMethods = value;
    },
    raw(path: string, handler: (request: TransportRequest) => Promise<TransportResponse>) {
      rawHandlers.set(path, handler);
    },
    methods(value: NativeMethods) {
      methods = value;
    },
    reply(path: string, data: unknown) {
      handlers.set(`/api/auth/native/attempts/${ATTEMPT_ID}/${path}`, async () => data);
    },
    handle(path: string, handler: (request: TransportRequest) => Promise<unknown>) {
      handlers.set(`/api/auth/native/attempts/${ATTEMPT_ID}/${path}`, handler);
    },
    async input(testID: string, value: string) {
      const change = byTestId(root, testID).props.onChangeText;
      if (typeof change !== 'function') throw new Error(`No input for ${testID}`);
      act(() => change(value));
      await flush();
    },
  };
}

export function recordProviderButton() {
  const seen: NativeProviderButtonProps[] = [];
  function ProviderButton(props: NativeProviderButtonProps) {
    seen.push(props);
    return createElement(Button, {
      label: props.label,
      onPress: props.onPress,
      testID: props.testID,
      disabled: props.disabled,
      busy: props.pending,
    });
  }
  return { seen, ProviderButton };
}
