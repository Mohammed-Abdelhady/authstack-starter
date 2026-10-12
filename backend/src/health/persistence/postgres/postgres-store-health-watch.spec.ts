import { HandTimers } from '../../../common/persistence/postgres/hand-timers.harness-spec';
import { PostgresStoreHealth } from './postgres-store-health';
import {
  PostgresStoreHealthWatch,
  STORE_HEALTH_INTERVAL_MS,
} from './postgres-store-health-watch';

/** The driver's pool, as far as the health adapter uses it. */
function watchOn(answers: Array<boolean | 'down'>): {
  health: PostgresStoreHealth;
  watch: PostgresStoreHealthWatch;
  timers: HandTimers;
  asked: () => number;
} {
  let asked = 0;
  const query = jest.fn().mockImplementation(() => {
    const answer = answers[Math.min(asked, answers.length - 1)];
    asked += 1;
    return answer === 'down'
      ? Promise.reject(new Error('connection refused'))
      : Promise.resolve({ rows: [{ writable: answer }] });
  });
  const health = new PostgresStoreHealth({ query });
  const timers = new HandTimers();
  return {
    health,
    watch: new PostgresStoreHealthWatch(health, timers),
    timers,
    asked: () => asked,
  };
}

describe('PostgresStoreHealthWatch', () => {
  it('asks once before the application serves, then on its interval', async () => {
    const { health, watch, timers, asked } = watchOn([true]);
    const beforeBoot = health.current();

    await watch.onApplicationBootstrap();
    const atBoot = { state: health.current(), asked: asked() };
    await watch.onModuleDestroy();

    expect({ beforeBoot, atBoot, intervals: timers.intervals }).toEqual({
      beforeBoot: 'unreachable',
      atBoot: { state: 'ready', asked: 1 },
      intervals: [STORE_HEALTH_INTERVAL_MS],
    });
  });

  it('follows the server on every tick: ready, read only, gone', async () => {
    const { health, watch, timers } = watchOn([true, false, 'down']);
    await watch.onApplicationBootstrap();
    const seen = [health.current()];

    for (let tick = 0; tick < 2; tick += 1) {
      timers.tick();
      // The look a tick started is the one this joins.
      await watch.runOnce();
      seen.push(health.current());
    }
    await watch.onModuleDestroy();

    expect(seen).toEqual(['ready', 'not_writable', 'unreachable']);
  });

  it('asks nothing more once it is destroyed', async () => {
    const { watch, timers, asked } = watchOn([true]);
    await watch.onApplicationBootstrap();

    await watch.onModuleDestroy();
    timers.tick();
    await watch.runOnce();

    expect(asked()).toBe(1);
  });
});
