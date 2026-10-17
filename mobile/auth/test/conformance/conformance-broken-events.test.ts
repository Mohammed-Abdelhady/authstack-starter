import { describe } from 'vitest';
import { PortAbortController } from '../../src/runtime/abort-controller';
import type { AuthBrowserPort, CallbackPort, ClockPort, TimerPort } from '../../src';
import { type BrokenAdapter, itCatches } from '../support/conformance-broken';
import { LaunchCallbacks } from '../support/conformance-fakes';
import { FakeCallbacks } from '../support/support';

/** Longer than a scripted session takes, shorter than the suite waits. */
const EARLY_REPORT_TURNS = 12;
const BOTH_MONOTONIC_CHECKS = ['clock.monotonic-never-backwards', 'clock.monotonic-milliseconds'];
const BOTH_TIMER_CHECKS = ['timer.fires-once', 'timer.cancel'];
const BOTH_LAUNCH_READ_CHECKS = ['callbacks.cold-start-once', 'callbacks.launch-unavailable'];

function browser(
  fault: string,
  fails: string[],
  open: (inner: AuthBrowserPort) => AuthBrowserPort['open'],
): BrokenAdapter {
  return {
    fault,
    fails,
    install(subject) {
      subject.adapters.authBrowser = { open: open(subject.parts.authBrowser) };
    },
  };
}

function browserResult(
  fault: string,
  fails: string[],
  change: (result: Awaited<ReturnType<AuthBrowserPort['open']>>) => typeof result,
): BrokenAdapter {
  return browser(
    fault,
    fails,
    (inner) => async (address, redirectUri, signal) =>
      change(await inner.open(address, redirectUri, signal)),
  );
}

type Launch = (address: string | undefined) => FakeCallbacks;

function callbacks(fault: string, fails: string[], launch: Launch): BrokenAdapter {
  return {
    fault,
    fails,
    install(subject) {
      subject.parts.makeCallbacks = launch;
    },
  };
}

/** A correct adapter with one method replaced. The driver still delivers through it. */
function launchWith(
  address: string | undefined,
  broken: (inner: LaunchCallbacks) => Partial<CallbackPort>,
): FakeCallbacks {
  const port = new LaunchCallbacks(address);
  return Object.assign(port, broken(port));
}

function clock(fault: string, fails: string[], broken: (inner: ClockPort) => Partial<ClockPort>) {
  return {
    fault,
    fails,
    install(subject) {
      const inner = subject.parts.clock;
      subject.adapters.clock = {
        wallTime: () => inner.wallTime(),
        monotonicTime: () => inner.monotonicTime(),
        ...broken(inner),
      };
    },
  } satisfies BrokenAdapter;
}

function timer(fault: string, fails: string[], after: (inner: TimerPort) => TimerPort['after']) {
  return {
    fault,
    fails,
    install(subject) {
      subject.adapters.timer = { after: after(subject.parts.timer) };
    },
  } satisfies BrokenAdapter;
}

describe('sign-in browser faults', () => {
  itCatches([
    browserResult('drops the query of the return address', ['authBrowser.redirect'], (result) =>
      result.kind === 'redirect'
        ? { kind: 'redirect', url: result.url.split('?', 1).join('') }
        : result,
    ),
    browser(
      'changes the address before opening it',
      ['authBrowser.redirect'],
      (inner) => (address, redirectUri, signal) =>
        inner.open(address.toLowerCase(), redirectUri, signal),
    ),
    browser(
      'ignores the abort signal',
      ['authBrowser.abort'],
      (inner) => (address, redirectUri) =>
        inner.open(address, redirectUri, new PortAbortController().signal),
    ),
    browser(
      'reports before the session ends',
      ['authBrowser.abort'],
      (inner) => async (address, redirectUri, signal) => {
        const session = inner.open(address, redirectUri, signal);
        let ended = false;
        void session.then(() => (ended = true));
        for (let turn = 0; turn < EARLY_REPORT_TURNS; turn += 1) await Promise.resolve();
        return ended ? session : { kind: 'dismissed' };
      },
    ),
    browser(
      'reports a redirect when aborted',
      ['authBrowser.abort'],
      (inner) => async (address, redirectUri, signal) => {
        const result = await inner.open(address, redirectUri, signal);
        return signal.aborted ? { kind: 'redirect', url: 'sampleapp://auth/callback' } : result;
      },
    ),
    browser(
      'leaves the browser open when aborted',
      ['authBrowser.abort'],
      (inner) => (address, redirectUri, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'cancelled' }));
          void inner.open(address, redirectUri, new PortAbortController().signal).then(resolve);
        }),
    ),
  ]);
});

describe('return address faults', () => {
  itCatches([
    callbacks('loses the launch address', BOTH_LAUNCH_READ_CHECKS, (address) =>
      launchWith(address, () => ({ initialAddress: async () => ({ kind: 'none' }) })),
    ),
    callbacks('returns the launch address on every read', BOTH_LAUNCH_READ_CHECKS, (address) =>
      launchWith(address, (inner) => {
        const read = inner.initialAddress.bind(inner);
        let first: ReturnType<CallbackPort['initialAddress']> | undefined;
        return { initialAddress: () => (first ??= read()) };
      }),
    ),
    callbacks(
      'returns an empty address for a plain start',
      ['callbacks.no-cold-start'],
      (address) =>
        launchWith(address, (inner) => {
          const read = inner.initialAddress.bind(inner);
          return {
            initialAddress: async () =>
              address === undefined ? { kind: 'address', address: '' } : read(),
          };
        }),
    ),
    callbacks(
      'hands every link to a listener twice',
      ['callbacks.warm-start-once', 'callbacks.same-address-both-ways', 'callbacks.unsubscribe'],
      (address) =>
        launchWith(address, (inner) => {
          const subscribe = inner.subscribe.bind(inner);
          return {
            subscribe: (listener) =>
              subscribe(async (link) => {
                await listener(link);
                await listener(link);
              }),
          };
        }),
    ),
    callbacks(
      'repeats the launch address as an event',
      ['callbacks.same-address-both-ways'],
      (address) => Object.assign(new FakeCallbacks(), { initial: address }),
    ),
    callbacks(
      'drops later links after a launch from a link',
      ['callbacks.same-address-both-ways'],
      (address) =>
        launchWith(address, (inner) => {
          const subscribe = inner.subscribe.bind(inner);
          return {
            subscribe: (listener) =>
              subscribe((link) => (address && link !== address ? undefined : listener(link))),
          };
        }),
    ),
    callbacks('keeps a listener after unsubscribe', ['callbacks.unsubscribe'], (address) =>
      launchWith(address, (inner) => {
        const subscribe = inner.subscribe.bind(inner);
        return {
          subscribe: (listener) => {
            subscribe(listener);
            return () => undefined;
          },
        };
      }),
    ),
    callbacks('removes every listener on unsubscribe', ['callbacks.unsubscribe'], (address) =>
      launchWith(address, (inner) => {
        const subscribe = inner.subscribe.bind(inner);
        return {
          subscribe: (listener) => {
            subscribe(listener);
            return () => inner.listeners.clear();
          },
        };
      }),
    ),
  ]);
});

describe('clock faults', () => {
  itCatches([
    clock(
      'derives elapsed time from the wall clock',
      ['clock.monotonic-never-backwards'],
      (inner) => ({ monotonicTime: () => inner.wallTime() }),
    ),
    clock('counts elapsed time in seconds', ['clock.monotonic-milliseconds'], (inner) => ({
      monotonicTime: () => inner.monotonicTime() / 1000,
    })),
    clock('counts elapsed time in microseconds', ['clock.monotonic-milliseconds'], (inner) => ({
      monotonicTime: () => inner.monotonicTime() * 1000,
    })),
    clock('has no elapsed time to report', BOTH_MONOTONIC_CHECKS, () => ({
      monotonicTime: () => Number.NaN,
    })),
    clock('counts elapsed time down', BOTH_MONOTONIC_CHECKS, (inner) => {
      let reads = 0;
      return { monotonicTime: () => inner.monotonicTime() - (reads += 1) * 10_000 };
    }),
    clock('reports wall time in seconds', ['clock.wall-milliseconds'], (inner) => ({
      wallTime: () => inner.wallTime() / 1000,
    })),
    clock('measures wall time from app start', ['clock.wall-milliseconds'], (inner) => ({
      wallTime: () => inner.monotonicTime(),
    })),
    clock('caches wall time', ['clock.wall-milliseconds'], (inner) => {
      const cached = inner.wallTime();
      return { wallTime: () => cached };
    }),
  ]);
});

describe('timer faults', () => {
  itCatches([
    timer('keeps firing like an interval', ['timer.fires-once'], (inner) => (delay, callback) => {
      const repeat = (): void => {
        callback();
        inner.after(delay, repeat);
      };
      return inner.after(delay, repeat);
    }),
    timer(
      'fires before the delay has passed',
      ['timer.fires-once'],
      (inner) => (delay, callback) => inner.after(delay / 4, callback),
    ),
    timer('fires while scheduling', BOTH_TIMER_CHECKS, () => (_delay, callback) => {
      callback();
      return () => undefined;
    }),
    timer('never fires', BOTH_TIMER_CHECKS, () => () => () => undefined),
    timer(
      'fires long after the delay',
      BOTH_TIMER_CHECKS,
      (inner) => (delay, callback) => inner.after(delay * 3, callback),
    ),
    timer('cannot be cancelled', ['timer.cancel'], (inner) => (delay, callback) => {
      inner.after(delay, callback);
      return () => undefined;
    }),
  ]);
});
