import type { Request } from 'express';
import type { AppException } from '../../../common/exceptions/app.exception';
import type { ApplicationRegistry } from '../../../session/applications/application-registry';
import type { BrowserApplications } from '../../../session/applications/browser-applications';

export function validChallengePolicyVersion(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && typeof value === 'number' && value >= 0)
  );
}

export async function assertBrowserChallengePolicy(
  applications: BrowserApplications,
  registry: ApplicationRegistry | undefined,
  challenge: {
    request: Request;
    policyVersion?: number;
    invalid: () => AppException;
  },
): Promise<void> {
  if (challenge.policyVersion === undefined) return;
  if (!registry) throw challenge.invalid();
  const clientId = applications.current(challenge.request).clientId;
  const stored = await registry.requireEnabled(clientId);
  if ((stored.policyVersion ?? 0) !== challenge.policyVersion)
    throw challenge.invalid();
  applications.rememberAdmission(challenge.request, (application) => {
    if ((application.policyVersion ?? 0) !== challenge.policyVersion)
      throw challenge.invalid();
  });
}
