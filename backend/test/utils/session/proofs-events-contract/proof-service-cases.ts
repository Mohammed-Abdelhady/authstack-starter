import { browserApplicationsForTest } from '../../../../src/common/testing/browser-applications.harness-spec';
import { BROWSER_PROOF_COOKIE } from '../../../../src/session/constants/browser-proof';
import {
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import { ConfigService } from '@nestjs/config';
import { BrowserProofService } from '../../../../src/session/services/browser-proof.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { RaceGate, holdBefore } from '../../race-gate';
import {
  CapturedCookie,
  codeOf,
  HarnessSource,
  NOW,
  PROOF_COOKIE,
  PROOF_LIFETIME_MS,
  rejectionOf,
  requestWith,
  responseCapturing,
} from './proofs-events-contract-support';

const SHA_256_HEX = /^[0-9a-f]{64}$/;

interface IssuedProof {
  proofId: string;
  token: string;
}

/** The real proof service on this database's store. */
export function proofServiceCases(harness: HarnessSource): void {
  const issue = async (): Promise<IssuedProof> => {
    const cookies: CapturedCookie[] = [];
    const token = await harness().proofService.issue(
      responseCapturing(cookies),
    );
    if (cookies.length !== 1 || cookies[0].name !== PROOF_COOKIE) {
      throw new Error('the proof cookie was not set exactly once');
    }
    return { proofId: cookies[0].value, token };
  };
  const consume = (proofId: string | undefined, token: string) =>
    harness().proofService.consume(requestWith(proofId), token);
  const refusal = async (proofId: string | undefined, token: string) =>
    codeOf(await rejectionOf(consume(proofId, token)));

  it('issues a proof that expires fifteen minutes later and accepts it once', async () => {
    const proof = await issue();
    const count = await harness().proofCount();

    await consume(proof.proofId, proof.token);

    expect({
      count,
      tokenLooksRandom: SHA_256_HEX.test(proof.token),
      idDiffersFromToken: proof.proofId !== proof.token,
      again: await refusal(proof.proofId, proof.token),
      countAfter: await harness().proofCount(),
    }).toEqual({
      count: 1,
      tokenLooksRandom: true,
      idDiffersFromToken: true,
      again: ErrorCode.CSRF_INVALID,
      countAfter: 1,
    });
  });

  it.each([
    ['one millisecond before the lifetime ends', PROOF_LIFETIME_MS - 1, null],
    ['when the lifetime ends', PROOF_LIFETIME_MS, ErrorCode.CSRF_INVALID],
  ] as const)(
    'checks the time itself for a proof used %s',
    async (_, elapsedMs, expected) => {
      const proof = await issue();
      harness().clock.set(new Date(NOW.getTime() + elapsedMs));

      const outcome = await consume(proof.proofId, proof.token).then(
        () => null,
        codeOf,
      );

      expect({ outcome, stored: await harness().proofCount() }).toEqual({
        outcome: expected,
        stored: 1,
      });
    },
  );

  it('requires the proof cookie and reads nothing without it', async () => {
    const proof = await issue();

    expect({
      missing: await refusal(undefined, proof.token),
      stillUsable: await consume(proof.proofId, proof.token).then(() => true),
    }).toEqual({ missing: ErrorCode.CSRF_REQUIRED, stillUsable: true });
  });

  it('refuses an unknown proof and a wrong token, and spends nothing for either', async () => {
    const proof = await issue();

    expect({
      unknownProof: await refusal('f'.repeat(64), proof.token),
      wrongToken: await refusal(proof.proofId, 'e'.repeat(64)),
      stillUsable: await consume(proof.proofId, proof.token).then(() => true),
    }).toEqual({
      unknownProof: ErrorCode.CSRF_INVALID,
      wrongToken: ErrorCode.CSRF_INVALID,
      stillUsable: true,
    });
  });

  it('refuses a token that was issued with another browser proof', async () => {
    const mine = await issue();
    const theirs = await issue();

    expect({
      crossed: await refusal(mine.proofId, theirs.token),
      crossedBack: await refusal(theirs.proofId, mine.token),
      mineStillUsable: await consume(mine.proofId, mine.token).then(() => true),
      theirsStillUsable: await consume(theirs.proofId, theirs.token).then(
        () => true,
      ),
    }).toEqual({
      crossed: ErrorCode.CSRF_INVALID,
      crossedBack: ErrorCode.CSRF_INVALID,
      mineStillUsable: true,
      theirsStillUsable: true,
    });
  });

  // Failure: copying a proof cookie and header authorizes another application.
  it.each([WEB_CLIENT_ID, ADMIN_CLIENT_ID] as const)(
    'refuses a renamed %s proof without spending the original',
    async (clientId) => {
      const config = new ConfigService({
        NODE_ENV: 'test',
        cors: { adminUrl: 'http://admin.example.test' },
      });
      const browserApplications = browserApplicationsForTest(config);
      const service = new BrowserProofService(
        harness().proofs,
        config,
        harness().clock,
        browserApplications,
      );
      const request = requestWith(undefined);
      request.headers =
        clientId === ADMIN_CLIENT_ID
          ? { origin: 'http://admin.example.test' }
          : {};
      const cookies: CapturedCookie[] = [];
      const token = await service.issue(responseCapturing(cookies, request));
      const proofId = cookies[0].value;
      const crossed = requestWith(undefined);
      crossed.headers =
        clientId === WEB_CLIENT_ID
          ? { origin: 'http://admin.example.test' }
          : {};
      crossed.cookies = {
        [clientId === WEB_CLIENT_ID
          ? `${BROWSER_PROOF_COOKIE}-${ADMIN_CLIENT_ID}`
          : BROWSER_PROOF_COOKIE]: proofId,
      };
      await expect(service.consume(crossed, token)).rejects.toMatchObject({
        code: ErrorCode.CSRF_INVALID,
      });
      request.cookies = { [cookies[0].name]: proofId };
      await service.consume(request, token);
      await expect(service.consume(request, token)).rejects.toMatchObject({
        code: ErrorCode.CSRF_INVALID,
      });
    },
  );

  it('accepts exactly one of two uses that both read the proof before either claims it', async () => {
    const proof = await issue();
    const gates = [new RaceGate(), new RaceGate()];
    const restore = holdBefore(
      harness().proofs,
      'claimBrowserProof',
      (call) => gates[call],
    );

    let results: PromiseSettledResult<void>[] | undefined;
    try {
      const first = consume(proof.proofId, proof.token);
      const second = consume(proof.proofId, proof.token);
      await Promise.all(gates.map((gate) => gate.reached(1)));
      gates.forEach((gate) => gate.release());
      results = await Promise.allSettled([first, second]);
    } finally {
      gates.forEach((gate) => gate.release());
      restore();
    }

    expect({
      accepted: results.filter(({ status }) => status === 'fulfilled').length,
      refused: results.flatMap((result) =>
        result.status === 'rejected' ? [codeOf(result.reason)] : [],
      ),
      stored: await harness().proofCount(),
    }).toEqual({
      accepted: 1,
      refused: [ErrorCode.CSRF_INVALID],
      stored: 1,
    });
  });
}
