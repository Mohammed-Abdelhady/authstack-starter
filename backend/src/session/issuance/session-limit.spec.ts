import { sessionCapReached } from './session-limit';

const WEB = { clientId: 'web' };
const ADMIN = { clientId: 'admin' };

describe('session cap selection', () => {
  // Failure: a configured cap counts another application's sessions.
  it('counts only the selected application for a configured cap', () => {
    expect(sessionCapReached({ ...WEB, sessionCap: 1 }, ['admin'])).toBe(false);
    expect(sessionCapReached({ ...WEB, sessionCap: 1 }, ['admin', 'web'])).toBe(
      true,
    );
  });

  // Failure: a configured cap retains an undocumented global ceiling of 20.
  it('replaces the global fallback when the cap is configured', () => {
    const twenty = Array.from({ length: 20 }, () => 'web');
    expect(sessionCapReached({ ...WEB, sessionCap: 21 }, twenty)).toBe(false);
    expect(
      sessionCapReached({ ...WEB, sessionCap: 21 }, [...twenty, 'web']),
    ).toBe(true);
  });

  // Failure: removing a cap loses the legacy combined 20 or admin 5 checks.
  it('retains the exact global and admin fallbacks when no cap is configured', () => {
    const nineteen = Array.from({ length: 19 }, () => 'web');
    const fourAdmin = ['admin', 'admin', 'admin', 'admin'];
    const fiveAdmin = [...fourAdmin, 'admin'];
    expect(sessionCapReached(WEB, nineteen)).toBe(false);
    expect(sessionCapReached(ADMIN, [...nineteen, 'web'])).toBe(true);
    expect(sessionCapReached(WEB, fiveAdmin)).toBe(false);
    expect(sessionCapReached(ADMIN, fourAdmin)).toBe(false);
    expect(sessionCapReached(ADMIN, fiveAdmin)).toBe(true);
  });
});
