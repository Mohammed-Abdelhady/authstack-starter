/**
 * Native sessions record no verified passkey evidence yet, so nothing could
 * hold a native sign-in to a required passkey. Remove this refusal once native
 * issuance stores the requirement and enforces it.
 */
export function refuseNativeRequiredPasskey(application: string): never {
  throw new Error(
    `${application}: requirePasskey=true is not available for a native application until native sign-in records verified passkey evidence; set requirePasskey to false`,
  );
}
