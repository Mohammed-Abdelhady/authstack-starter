import { TEST_NOW } from '../../frozen-clock';
import { AuthorityHarnessSource, signIn } from './authority-contract-support';

/** The contract's web application: idle for ten minutes, two hours in all. */
const IDLE_DEADLINE = new Date('2099-01-01T12:10:00.000Z');
const ABSOLUTE_DEADLINE = new Date('2099-01-01T14:00:00.000Z');

/** What a validation does to the idle deadline, through the real service. */
export function authorityExtensionCases(harness: AuthorityHarnessSource): void {
  it('leaves a session with fresh activity as it is', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    harness().issuance.clock.set(new Date('2099-01-01T12:01:00.000Z'));
    const validated = await harness().validator().validateByToken(token, true);
    const stored = await harness().session(sessionId);
    expect({
      extended: validated?.extended,
      idleExpiresAt: stored?.idleExpiresAt,
      lastActivityAt: stored?.lastActivityAt,
    }).toEqual({
      extended: false,
      idleExpiresAt: IDLE_DEADLINE,
      lastActivityAt: TEST_NOW,
    });
  });

  it('extends a session with stale activity, in the answer and in what is stored', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    const sixMinutesIn = new Date('2099-01-01T12:06:00.000Z');
    harness().issuance.clock.set(sixMinutesIn);
    const untouched = await harness().validator().validateByToken(token, false);
    const storedUntouched = await harness().session(sessionId);
    const validated = await harness().validator().validateByToken(token, true);
    const stored = await harness().session(sessionId);
    expect({
      untouched: {
        extended: untouched?.extended,
        idleExpiresAt: storedUntouched?.idleExpiresAt,
      },
      answer: {
        extended: validated?.extended,
        idleExpiresAt: validated?.session.idleExpiresAt,
        lastActivityAt: validated?.session.lastActivityAt,
        lastUsedAt: validated?.session.lastUsedAt,
      },
      stored: {
        idleExpiresAt: stored?.idleExpiresAt,
        lastActivityAt: stored?.lastActivityAt,
        lastUsedAt: stored?.lastUsedAt,
      },
    }).toEqual({
      untouched: { extended: false, idleExpiresAt: IDLE_DEADLINE },
      answer: {
        extended: true,
        idleExpiresAt: new Date('2099-01-01T12:16:00.000Z'),
        lastActivityAt: sixMinutesIn,
        lastUsedAt: sixMinutesIn,
      },
      stored: {
        idleExpiresAt: new Date('2099-01-01T12:16:00.000Z'),
        lastActivityAt: sixMinutesIn,
        lastUsedAt: sixMinutesIn,
      },
    });
  });

  it('never extends the idle deadline past the absolute one', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    await harness().patchSession(sessionId, {
      lastActivityAt: new Date('2099-01-01T13:54:00.000Z'),
      idleExpiresAt: new Date('2099-01-01T13:58:00.000Z'),
    });
    harness().issuance.clock.set(new Date('2099-01-01T13:55:00.000Z'));
    const validated = await harness().validator().validateByToken(token, true);
    expect({
      extended: validated?.extended,
      idleExpiresAt: (await harness().session(sessionId))?.idleExpiresAt,
    }).toEqual({ extended: true, idleExpiresAt: ABSOLUTE_DEADLINE });
  });
}
