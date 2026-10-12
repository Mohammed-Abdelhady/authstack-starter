import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { parseStoredRecord } from '../../src/storage/persistence';
import {
  CHALLENGE_NONCE,
  challengeThen,
  dpopChallenge,
  dpopTokenReply,
  enqueueBoundRefresh,
  establishBoundSession,
  proofNonces,
  refreshRequests,
} from '../support/device-bound-support';
import { queuedWorkDone } from '../support/queued-work';
import { Deferred, REFRESH_TOKEN, apiReply } from '../support/support';
import {
  allowBoundRefreshReplayAfterUnknownOutcome,
  allowRefreshReplayAfterDpopNonce,
  revokedTokens,
} from '../support/tracking';

const PROFILE = { method: HTTP_METHOD.GET, path: '/api/user/profile' } as const;
const REFRESH_DEADLINE_MS = 15_000;
const NEXT_NONCE = 'server-nonce-1';
const LAST_NONCE = 'server-nonce-2';

describe('a bound refresh the server challenges first', () => {
  it('answers a new challenge on the replay after a lost answer, and rotates', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      dpopChallenge(NEXT_NONCE),
      dpopTokenReply('access-1', 'refresh-1'),
      apiReply({ id: 'profile' }),
    );

    await engine.transport.request(PROFILE);

    expect(proofNonces(refreshRequests(transport))).toEqual([
      '',
      CHALLENGE_NONCE,
      CHALLENGE_NONCE,
      NEXT_NONCE,
    ]);
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      'refresh-1',
    );
    expect(engine.snapshot.status).toBe('signedIn');
  });

  it('answers a second challenge in a row and rotates', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopChallenge(NEXT_NONCE),
      dpopTokenReply('access-1', 'refresh-1'),
      apiReply({ id: 'profile' }),
    );

    await engine.transport.request(PROFILE);

    expect(proofNonces(refreshRequests(transport))).toEqual(['', CHALLENGE_NONCE, NEXT_NONCE]);
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      'refresh-1',
    );
    expect(engine.snapshot.status).toBe('signedIn');
  });

  it('gives up after the third challenge in a row and keeps the session, since nothing was spent', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopChallenge(NEXT_NONCE),
      dpopChallenge(LAST_NONCE),
    );

    await expect(engine.transport.request(PROFILE)).rejects.toMatchObject({
      name: 'DpopChallengeLimitError',
      cause: { error: 'use_dpop_nonce' },
    });

    expect(proofNonces(refreshRequests(transport))).toEqual(['', CHALLENGE_NONCE, NEXT_NONCE]);
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    const stored = parseStoredRecord(ports.credentials.value ?? '');
    expect(stored?.tokens?.refreshToken).toBe(REFRESH_TOKEN);
    expect(stored?.refreshInFlight).toBeUndefined();
  });

  it('asks for sign-in when the challenges run out after a lost answer, since the token may be spent', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      dpopChallenge(NEXT_NONCE),
      dpopChallenge(LAST_NONCE),
    );

    await expect(engine.transport.request(PROFILE)).rejects.toBeInstanceOf(OAuthError);

    expect(proofNonces(refreshRequests(transport))).toEqual([
      '',
      CHALLENGE_NONCE,
      CHALLENGE_NONCE,
      NEXT_NONCE,
    ]);
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'refreshInterrupted',
    });
    expect(parseStoredRecord(ports.credentials.value ?? '')).toMatchObject({
      tokens: { refreshToken: REFRESH_TOKEN },
      refreshInFlight: true,
    });
  });

  it('sends the token once more, and no more, after an answer is lost behind two challenges', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopChallenge(NEXT_NONCE),
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
    );

    await expect(engine.transport.request(PROFILE)).rejects.toBeInstanceOf(TransportError);

    expect(proofNonces(refreshRequests(transport))).toEqual([
      '',
      CHALLENGE_NONCE,
      NEXT_NONCE,
      NEXT_NONCE,
    ]);
    expect(engine.snapshot.status).toBe('reauthRequired');
  });

  it('runs the challenge and the retry under one deadline, and asks for sign-in when it passes', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    const retrySent = new Deferred<void>();
    const answer = new Deferred<ReturnType<typeof dpopTokenReply>>();
    const deadlinesBefore = ports.timer.scheduled.filter((delay) => delay === REFRESH_DEADLINE_MS);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      () => answer.promise,
      ...challengeThen({ status: 200, body: {} }),
    );
    transport.onRequest = () => {
      if (refreshRequests(transport).length === 2) retrySent.resolve();
    };

    const request = engine.transport.request(PROFILE);
    await retrySent.promise;
    const deadlines = ports.timer.scheduled.filter((delay) => delay === REFRESH_DEADLINE_MS);
    ports.timer.fireDelay(REFRESH_DEADLINE_MS);

    await expect(request).rejects.toMatchObject({ reason: TRANSPORT_FAILURE.NO_RESPONSE });
    expect(deadlines).toHaveLength(deadlinesBefore.length + 1);
    expect(refreshRequests(transport)).toHaveLength(2);
    expect(refreshRequests(transport)[1]?.signal?.aborted).toBe(true);
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'refreshInterrupted',
    });
    expect(parseStoredRecord(ports.credentials.value ?? '')).toMatchObject({
      tokens: { refreshToken: REFRESH_TOKEN },
      refreshInFlight: true,
    });

    answer.resolve(dpopTokenReply('access-late', 'refresh-late'));
    await queuedWorkDone();
    expect(revokedTokens(transport)).toEqual(['refresh-late', 'refresh-late']);
    expect(proofNonces(transport.sent.filter(({ path }) => path === '/api/oauth/revoke'))).toEqual([
      '',
      CHALLENGE_NONCE,
    ]);
    expect(engine.snapshot.status).toBe('reauthRequired');
  });
});
