import { Client } from 'pg';

export function failPostgresRead(
  read: 'sessions' | 'password',
  driverText: string,
): () => void {
  const spy = jest.spyOn(Client.prototype, 'query');
  const query = spy.getMockImplementation();
  if (!query) {
    spy.mockRestore();
    throw new Error('The PostgreSQL driver query was not captured');
  }
  spy.mockImplementation(function (this: Client, ...args) {
    const statement: unknown = args[0];
    const matches =
      typeof statement === 'string' &&
      (read === 'sessions'
        ? statement.includes('from "sessions"') &&
          statement.includes('order by "last_used_at" desc')
        : statement.includes('"password_hash"'));
    if (matches) {
      throw Object.assign(new Error(driverText), { code: 'ECONNREFUSED' });
    }
    return query.apply(this, args);
  });
  return () => spy.mockRestore();
}
