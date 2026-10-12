import { Client, Pool } from 'pg';
import { DRIVER_FAILURE } from './postgres-driver-failures';

/**
 * The installed source of one driver method. The pool's methods are read off
 * the class the driver exports, which is how this package reaches pg-pool.
 */
function sourceOf(owner: object, method: string): string {
  const found: unknown = Reflect.get(owner, method);
  if (typeof found !== 'function') {
    throw new Error(`The installed driver has no ${method}`);
  }
  return Function.prototype.toString.call(found);
}

describe('the driver messages the PostgreSQL adapter maps', () => {
  it.each([
    [
      'the wait for a free connection',
      DRIVER_FAILURE.POOL_WAIT_TIMEOUT,
      () => sourceOf(Pool.prototype, 'connect'),
    ],
    [
      'the connection timeout',
      DRIVER_FAILURE.CONNECT_TIMEOUT,
      () => sourceOf(Pool.prototype, 'newClient'),
    ],
    [
      'the read timeout',
      DRIVER_FAILURE.QUERY_READ_TIMEOUT,
      () => sourceOf(Client.prototype, 'query'),
    ],
    [
      'the closed socket',
      DRIVER_FAILURE.CONNECTION_TERMINATED,
      () => sourceOf(Client.prototype, '_connect'),
    ],
    [
      'the failed connection',
      DRIVER_FAILURE.NOT_QUERYABLE,
      () => sourceOf(Client.prototype, 'query'),
    ],
  ])('still finds %s raised by the installed driver', (_, message, source) => {
    const raised = source().includes(`new Error('${message}'`);

    expect(raised).toBe(true);
  });
});
