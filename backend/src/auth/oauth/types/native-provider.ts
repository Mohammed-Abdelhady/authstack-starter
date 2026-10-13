import type { NativeProviderCredential, NativeProviderMethod } from '@app/sdk';

export interface NativeProviderProof {
  credential: NativeProviderCredential;
  method: NativeProviderMethod;
  nonceDigest: string;
}
