import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore } from '../../race-gate';
import {
  begin,
  codeOf,
  NATIVE_CLIENT,
  NativeHarnessSource,
  outcomeOf,
  sha256Hex,
} from './native-contract-support';
import { nativeRaceTools } from './native-race-support';

const EXPIRED = ErrorCode.NATIVE_TRANSACTION_EXPIRED;

/** Approve and deny at once: both have read the request pending, one wins. */
export function authorizationRaceCases(harness: NativeHarnessSource): void {
  const { gate, restoreLater } = nativeRaceTools();

  it('gives two approvals of one request one winner, one code and one grant', async () => {
    const services = harness().services();
    const userId = await harness().issuance.seedAccount();
    const { transactionId } = await begin(services);
    const first = gate();
    const second = gate();
    restoreLater(
      holdBefore(harness().stores.authorizations, 'approve', (call) =>
        call === 0 ? first : call === 1 ? second : undefined,
      ),
    );

    const racers = [
      outcomeOf(services.authorize.approve(userId, transactionId, [])),
      outcomeOf(services.authorize.approve(userId, transactionId, [])),
    ];
    await first.reached(1);
    await second.reached(1);
    first.release();
    const winner = await Promise.race(racers);
    second.release();
    const answers = await Promise.all(racers);

    const codes = answers.filter(
      (answer): answer is { redirectUri: string } =>
        typeof answer === 'object' && answer !== null,
    );
    expect({
      winnerIsAnApproval: codes.includes(winner as { redirectUri: string }),
      refusals: answers.filter((answer) => answer === EXPIRED).length,
      approvals: codes.length,
      storedCodeIsTheWinners:
        (await harness().authorization(transactionId))?.codeHash ===
        sha256Hex(codeOf(codes[0].redirectUri)),
      grants: (await harness().issuance.grants(userId)).map(
        ({ clientId }) => clientId,
      ),
    }).toEqual({
      winnerIsAnApproval: true,
      refusals: 1,
      approvals: 1,
      storedCodeIsTheWinners: true,
      grants: [NATIVE_CLIENT],
    });
  });

  it.each([
    { released: 'the denial', approvalWins: false },
    { released: 'the approval', approvalWins: true },
  ])(
    'gives an approval and a denial of one request one winner when $released goes first',
    async ({ approvalWins }) => {
      const services = harness().services();
      const userId = await harness().issuance.seedAccount();
      const { transactionId } = await begin(services);
      const approval = gate();
      const denial = gate();
      restoreLater(
        holdBefore(harness().stores.authorizations, 'approve', (call) =>
          call === 0 ? approval : undefined,
        ),
      );
      restoreLater(
        holdBefore(harness().stores.authorizations, 'deny', (call) =>
          call === 0 ? denial : undefined,
        ),
      );

      const approving = outcomeOf(
        services.authorize.approve(userId, transactionId, []),
      );
      await approval.reached(1);
      const denying = outcomeOf(services.browser.deny(transactionId));
      await denial.reached(1);
      const [firstGate, secondGate] = approvalWins
        ? [approval, denial]
        : [denial, approval];
      firstGate.release();
      await (approvalWins ? approving : denying);
      secondGate.release();
      const [approved, denied] = [await approving, await denying];

      const stored = await harness().authorization(transactionId);
      expect({
        approved: approved === EXPIRED ? EXPIRED : 'approved',
        denied: denied === EXPIRED ? EXPIRED : 'denied',
        stored: {
          consumed: stored?.consumed,
          hasCode: stored?.codeHash !== null,
        },
        grants: (await harness().issuance.grants(userId)).length,
      }).toEqual(
        approvalWins
          ? {
              approved: 'approved',
              denied: EXPIRED,
              stored: { consumed: false, hasCode: true },
              grants: 1,
            }
          : {
              approved: EXPIRED,
              denied: 'denied',
              stored: { consumed: true, hasCode: false },
              grants: 0,
            },
      );
    },
  );

  it('gives two denials of one request one winner', async () => {
    const services = harness().services();
    const { transactionId } = await begin(services);
    const first = gate();
    const second = gate();
    restoreLater(
      holdBefore(harness().stores.authorizations, 'deny', (call) =>
        call === 0 ? first : call === 1 ? second : undefined,
      ),
    );

    const racers = [
      outcomeOf(services.browser.deny(transactionId)),
      outcomeOf(services.browser.deny(transactionId)),
    ];
    await first.reached(1);
    await second.reached(1);
    first.release();
    second.release();
    const answers = await Promise.all(racers);

    expect({
      refusals: answers.filter((answer) => answer === EXPIRED).length,
      denials: answers.filter((answer) => answer !== EXPIRED).length,
    }).toEqual({ refusals: 1, denials: 1 });
  });
}
