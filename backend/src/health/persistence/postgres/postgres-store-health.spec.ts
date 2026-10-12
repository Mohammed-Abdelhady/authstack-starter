import { HandTimers } from '../../../common/persistence/postgres/hand-timers.harness-spec';
import { PostgresStoreHealth } from './postgres-store-health';
import { PostgresStoreHealthWatch } from './postgres-store-health-watch';

type Answer = { rows: Array<{ writable: boolean }> };

/** A server whose answers the spec gives by hand, one per statement sent. */
function silentServer(): {
  query: jest.Mock;
  answer: (statement: number, writable: boolean) => void;
  sent: () => number;
} {
  const pending: Array<(answer: Answer) => void> = [];
  const query = jest.fn().mockImplementation(
    () =>
      new Promise<Answer>((resolve) => {
        pending.push(resolve);
      }),
  );
  return {
    query,
    answer: (statement, writable) =>
      pending[statement]({ rows: [{ writable }] }),
    sent: () => pending.length,
  };
}

describe('PostgresStoreHealth when the server does not answer', () => {
  it('counts a look as unreachable after three seconds without an answer', async () => {
    const server = silentServer();
    const timers = new HandTimers();
    const health = new PostgresStoreHealth({ query: server.query }, timers);

    const first = health.observe();
    server.answer(0, true);
    const whileAnswering = await first;
    const second = health.observe();
    timers.passDelays();
    const afterSilence = await second;

    expect({ whileAnswering, afterSilence, bound: timers.delays[1] }).toEqual({
      whileAnswering: 'ready',
      afterSilence: 'unreachable',
      bound: 3000,
    });
  });

  it('drops an answer that arrives after a later look was answered', async () => {
    const server = silentServer();
    const timers = new HandTimers();
    const health = new PostgresStoreHealth({ query: server.query }, timers);

    const earlier = health.observe();
    const later = health.observe();
    server.answer(1, false);
    await later;
    server.answer(0, true);
    await earlier;

    expect(health.current()).toBe('not_writable');
  });

  it('starts the next look on the next tick while an earlier statement still hangs', async () => {
    const server = silentServer();
    const timers = new HandTimers();
    const health = new PostgresStoreHealth({ query: server.query }, timers);
    const watch = new PostgresStoreHealthWatch(health, timers);
    const booting = watch.onApplicationBootstrap();
    timers.passDelays();
    await booting;

    timers.tick();
    const sentAfterTick = server.sent();
    server.answer(1, true);
    await watch.runOnce();
    const state = health.current();
    await watch.onModuleDestroy();

    expect({ sentAfterTick, state }).toEqual({
      sentAfterTick: 2,
      state: 'ready',
    });
  });

  it('ends its own connection with the watch, within the bound when ending hangs', async () => {
    const timers = new HandTimers();
    const health = new PostgresStoreHealth(
      { query: jest.fn().mockResolvedValue({ rows: [{ writable: true }] }) },
      timers,
    );
    const end = jest.fn().mockImplementation(() => new Promise<void>(() => {}));
    const watch = new PostgresStoreHealthWatch(health, timers, {
      end,
      ended: false,
    });
    await watch.onApplicationBootstrap();

    let destroyed = false;
    const destroying = watch.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    const beforeTheBound = destroyed;
    timers.passDelays();
    await destroying;

    expect({
      beforeTheBound,
      destroyed,
      ended: end.mock.calls.length,
      waited: timers.delays.at(-1),
    }).toEqual({
      beforeTheBound: false,
      destroyed: true,
      ended: 1,
      waited: 5000,
    });
  });
});
