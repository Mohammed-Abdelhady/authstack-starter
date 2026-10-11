import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore } from '../../race-gate';
import { SEES_COMMITS } from './native-contract-harness';
import {
  answerOf,
  approvedCode,
  begin,
  codeOf,
  exchange,
  NATIVE_CLIENT,
  NativeHarnessSource,
  outcomeOf,
  signInNative,
} from './native-contract-support';
import { nativeRaceTools, REFUSED } from './native-race-support';

/**
 * Mobile sign-in against the two changes the application registry owns:
 * blocking a person from the application, and switching the application off.
 */
export function applicationJoinRaceCases(harness: NativeHarnessSource): void {
  const { gate, restoreLater, heldReruns, refusedOr } = nativeRaceTools();

  /** The person's grants, with the version the registry's own read gives. */
  async function storedGrant(userId: string) {
    const grant = await harness().stores.grants.readGrant(
      userId,
      NATIVE_CLIENT,
    );
    return (await harness().issuance.grants(userId)).map(
      ({ clientId, allowed }) => ({
        clientId,
        allowed,
        sessionVersion: grant?.sessionVersion,
      }),
    );
  }

  it('begins nothing for a mobile application that is switched off, and begins again once it is back on', async () => {
    const services = harness().services();
    const query = {
      response_type: 'code',
      client_id: NATIVE_CLIENT,
      redirect_uri: 'myapp://callback',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      state: 's',
    };

    await services.applications.disableApplication(NATIVE_CLIENT);
    const whileOff = await services.authorize.begin(query);
    await services.applications.enableApplication(NATIVE_CLIENT);
    const backOn = await services.authorize.begin(query);

    expect({
      whileOff: whileOff.ok ? 'begun' : whileOff.error,
      backOn: backOn.ok ? 'begun' : backOn.error,
    }).toEqual({ whileOff: 'unauthorized_client', backOn: 'begun' });
  });

  it('refuses a block while an approval that creates the first grant is open, and blocks that grant once it reruns', async () => {
    const userId = await harness().issuance.seedAccount();
    const reruns = heldReruns();
    const approvalCreatedGrant = gate();
    const blockWrote = gate();
    const approving = harness().services();
    const { transactionId, verifier } = await begin(approving);
    restoreLater(
      holdBefore(
        harness().stores.authorizations,
        'captureGrantVersion',
        () => approvalCreatedGrant,
      ),
    );
    restoreLater(
      holdBefore(
        harness().stores.grants,
        'appendSecurityEvent',
        () => blockWrote,
      ),
    );

    const approval = approving.authorize.approve(userId, transactionId, []);
    await approvalCreatedGrant.reached(1);
    const blocking = outcomeOf(
      harness()
        .services({ pause: reruns.pause })
        .applications.blockGrant(userId, NATIVE_CLIENT),
    );
    const blockWas = await refusedOr(reruns.refused, blockWrote);
    approvalCreatedGrant.release();
    blockWrote.release();
    const approved = await approval;
    reruns.refused.release();
    const blocked = await blocking;

    expect({
      blockWas,
      blocked,
      pauses: reruns.calls,
      grants: await storedGrant(userId),
      codeAnswers: answerOf(
        await exchange(harness().services(), {
          code: codeOf(approved.redirectUri),
          verifier,
        }),
      ),
      sessions: (await harness().issuance.sessions(userId)).length,
    }).toEqual({
      blockWas: REFUSED,
      blocked: undefined,
      pauses: [1],
      grants: [{ clientId: NATIVE_CLIENT, allowed: false, sessionVersion: 1 }],
      codeAnswers: 'invalid_grant',
      sessions: 0,
    });
  });

  it('refuses an approval while a block that creates the first grant is open, and keeps it out once it reruns', async () => {
    const userId = await harness().issuance.seedAccount();
    const reruns = heldReruns();
    const blockWrote = gate();
    const approvalCreatedGrant = gate();
    const { transactionId } = await begin(harness().services());
    restoreLater(
      holdBefore(
        harness().stores.grants,
        'appendSecurityEvent',
        () => blockWrote,
      ),
    );
    restoreLater(
      holdBefore(
        harness().stores.authorizations,
        'captureGrantVersion',
        () => approvalCreatedGrant,
      ),
    );

    const blocking = harness()
      .services()
      .applications.blockGrant(userId, NATIVE_CLIENT);
    await blockWrote.reached(1);
    const approving = outcomeOf(
      harness()
        .services({ pause: reruns.pause })
        .authorize.approve(userId, transactionId, []),
    );
    const approvalWas = await refusedOr(reruns.refused, approvalCreatedGrant);
    blockWrote.release();
    approvalCreatedGrant.release();
    await blocking;
    reruns.refused.release();

    const stored = await harness().authorization(transactionId);
    expect({
      approvalWas,
      approved: await approving,
      pauses: reruns.calls,
      grants: await storedGrant(userId),
      request: { hasCode: stored?.codeHash !== null, user: stored?.userId },
    }).toEqual({
      approvalWas: REFUSED,
      approved: ErrorCode.GRANT_BLOCKED,
      pauses: [1],
      grants: [{ clientId: NATIVE_CLIENT, allowed: false, sessionVersion: 1 }],
      request: { hasCode: false, user: null },
    });
  });

  it('ends the tokens of an exchange that was open when the application was switched off, and switching it back on does not revive them', async () => {
    const userId = await harness().issuance.seedAccount();
    const services = harness().services();
    const code = await approvedCode(services, userId);
    const exchangeChecked = gate();
    const switchWrote = gate();
    restoreLater(
      holdBefore(harness().stores.authorizations, 'spendCodeIn', (call) =>
        call === 0 ? exchangeChecked : undefined,
      ),
    );
    restoreLater(
      holdBefore(harness().stores.grants, 'appendSecurityEvent', (call) =>
        call === 0 ? switchWrote : undefined,
      ),
    );

    const exchanging = exchange(services, code);
    await exchangeChecked.reached(1);
    const switching = services.applications.disableApplication(NATIVE_CLIENT);
    await switchWrote.reached(1);
    switchWrote.release();
    await switching;
    exchangeChecked.release();
    const exchanged = await exchanging;

    const token = exchanged.ok ? exchanged.accessToken : 'no token';
    const whileOff = await services.access.validate(token);
    await services.applications.enableApplication(NATIVE_CLIENT);
    const backOn = await services.access.validate(token);
    const fresh = await signInNative(harness(), { userId });
    expect({
      exchange: answerOf(exchanged),
      whileOff,
      backOn,
      aSignInAfterwardsValidates:
        (await services.access.validate(fresh.tokens.accessToken))?.account
          .id === userId,
    }).toEqual({
      exchange: 'ok',
      whileOff: null,
      backOn: null,
      aSignInAfterwardsValidates: true,
    });
  });

  it('issues nothing usable to an exchange that reads the application after it was switched off, and spends its code', async () => {
    const userId = await harness().issuance.seedAccount();
    const services = harness().services();
    const code = await approvedCode(services, userId);
    const exchangeTookCode = gate();
    const switchWrote = gate();
    restoreLater(
      holdBefore(harness().stores.registry, 'findClient', (call) =>
        call === 0 ? exchangeTookCode : undefined,
      ),
    );
    restoreLater(
      holdBefore(harness().stores.grants, 'appendSecurityEvent', (call) =>
        call === 0 ? switchWrote : undefined,
      ),
    );

    const exchanging = exchange(services, code);
    await exchangeTookCode.reached(1);
    const switching = services.applications.disableApplication(NATIVE_CLIENT);
    await switchWrote.reached(1);
    switchWrote.release();
    await switching;
    exchangeTookCode.release();
    const exchanged = await exchanging;

    const sawTheSwitch =
      harness().seesCommits === SEES_COMMITS.UNTIL_EACH_STATEMENT;
    await services.applications.enableApplication(NATIVE_CLIENT);
    expect({
      exchange: answerOf(exchanged),
      sessions: (await harness().issuance.sessions(userId)).length,
      tokenValidates: exchanged.ok
        ? await services.access.validate(exchanged.accessToken)
        : null,
      codeWorksAgain: answerOf(await exchange(services, code)),
    }).toEqual({
      exchange: sawTheSwitch ? 'invalid_grant' : 'ok',
      sessions: sawTheSwitch ? 0 : 1,
      tokenValidates: null,
      codeWorksAgain: 'invalid_grant',
    });
  });
}
