import { newPostgresId } from './postgres-new-id';

describe('newPostgresId', () => {
  // 0x0123456789ab milliseconds after the epoch.
  const AT = new Date(1_250_999_896_491);

  it('never makes the same id twice in one millisecond', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newPostgresId(AT)));

    expect(ids.size).toBe(2000);
  });
});
