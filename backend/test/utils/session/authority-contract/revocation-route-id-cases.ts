import { AppException } from '../../../../src/common/exceptions/app.exception';
import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { RouteIdPipe } from '../../../../src/common/pipes/route-id.pipe';
import { ROUTE_ID_REFUSAL, routeIdAnswer } from '../../route-id-answers';
import {
  rejectionOf,
  rerunAtOnce,
} from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  signIn,
  storedFor,
} from './authority-contract-support';

function answerOf(error: unknown): unknown {
  return error instanceof AppException
    ? { code: error.getCode(), status: error.getStatus() }
    : error;
}

/** A session id as the "revoke a session" route takes it. */
export function revocationRouteIdCases(harness: AuthorityHarnessSource): void {
  it('lets a session id this database hands out through a route', async () => {
    const userId = await harness().issuance.seedAccount();
    const { sessionId } = await signIn(harness(), userId);
    const absent = harness().absentSessionId();
    const pipe = new RouteIdPipe(harness().ids);

    expect([
      routeIdAnswer(pipe, sessionId),
      routeIdAnswer(pipe, absent),
    ]).toEqual([sessionId, absent]);
  });

  it('refuses a malformed session id at a route and in the store, and ends no session', async () => {
    const userId = await harness().issuance.seedAccount();
    const { sessionId } = await signIn(harness(), userId);
    const pipe = new RouteIdPipe(harness().ids);
    const store = harness().revocationStore;
    const runner = harness().issuance.runner(rerunAtOnce);

    for (const id of ['word', '', harness().foreignSessionId()]) {
      const read = await rejectionOf(
        runner.run((unit) => store.findLiveSessionOfAccount(unit, id, userId)),
      );
      // Past the route the service has no answer of its own for such an id.
      const revoked = await rejectionOf(
        harness().revoker(rerunAtOnce).revokeById(id, userId),
      );

      expect({
        route: routeIdAnswer(pipe, id),
        store: read instanceof MalformedIdError,
        service: answerOf(revoked),
      }).toEqual({
        route: ROUTE_ID_REFUSAL,
        store: true,
        service: { code: 'AUTHORITY_UNAVAILABLE', status: 503 },
      });
    }
    expect(await storedFor(harness(), userId, [sessionId])).toEqual({
      accountVersion: 0,
      sessions: [{ live: true, userVersion: 0 }],
      events: ['session_issued'],
    });
  });
}
