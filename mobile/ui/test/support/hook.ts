import type { AuthSnapshot } from '@app/native-auth';
import { createElement, type ReactElement } from 'react';
import { Provider } from 'react-redux';
import { UiContext, type Ui } from '../../src/context/ui-context';
import { createTranslate, DIRECTION, type Locale } from '../../src/i18n';
import { themeOf } from '../../src/logic/theme';
import { createUiRuntime, type UiRuntime } from '../../src/state/runtime';
import { createFakeEngine, type FakeEngine } from './fake-engine';
import { createFakeServer, type FakeServer } from './fake-server';
import { APP_NAME, flush, NOW, recordConfirm, render, type RecordedConfirm } from './render';

export interface HookSubject<Result> {
  /** What the hook returned on its latest render. */
  current(): Result;
  renders(): number;
}

/** Runs a hook inside a component and keeps what it returns. */
export function renderHook<Result>(
  useHook: () => Result,
  wrap: (child: ReactElement) => ReactElement = (child) => child,
): HookSubject<Result> {
  const seen: Result[] = [];
  function Probe(): null {
    seen.push(useHook());
    return null;
  }
  render(wrap(createElement(Probe)));
  return {
    current() {
      const latest = seen.at(-1);
      if (latest === undefined) throw new Error('The hook has not rendered.');
      return latest;
    },
    renders: () => seen.length,
  };
}

export interface UiHookSubject<Result> extends HookSubject<Result> {
  runtime: UiRuntime;
  server: FakeServer;
  fake: FakeEngine;
  confirm: RecordedConfirm;
}

/** Runs a screen hook over the real runtime, with what the root component would hand it. */
export async function renderUiHook<Result>(
  useHook: () => Result,
  initial: AuthSnapshot,
  locale: Locale = 'en',
): Promise<UiHookSubject<Result>> {
  const server = createFakeServer();
  const fake = createFakeEngine(server.transport, initial);
  const runtime = createUiRuntime(fake.engine);
  runtime.start();
  const confirm = recordConfirm();
  const ui: Ui = {
    colors: themeOf(null).colors,
    direction: DIRECTION[locale],
    locale,
    t: createTranslate(locale),
    reduceMotion: true,
    insets: { top: 0, bottom: 0, start: 0, end: 0 },
    runtime,
    now: () => NOW,
    confirm: confirm.confirm,
    appName: APP_NAME,
  };
  const subject = renderHook(useHook, (child) =>
    createElement(
      Provider,
      { store: runtime.store, children: null },
      createElement(UiContext.Provider, { value: ui }, child),
    ),
  );
  await flush();
  return { ...subject, runtime, server, fake, confirm };
}
