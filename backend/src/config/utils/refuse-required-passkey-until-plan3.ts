/** Remove this temporary refusal when plan 3 supplies verified sign-in evidence. */
export function refuseRequiredPasskeyUntilPlan3(
  requirePasskey: boolean | undefined,
  application: string,
): void {
  if (requirePasskey !== true) return;
  throw new Error(
    `Application ${JSON.stringify(application)}: requirePasskey=true is temporarily unavailable until the passkeys work (plan 3) supplies verified passkey sign-in evidence; set requirePasskey to false in this application's policy`,
  );
}
