import { ErrorCode } from '@app/core';
import { ApiError, type ApiClient } from '@app/sdk';
import type { AbortSignalPort } from '@app/native-auth';

interface Options {
  client: ApiClient<AbortSignalPort>;
  receiptKey: string;
  isCurrent: () => boolean;
  authorize: (error: ApiError, isCurrent: () => boolean) => Promise<boolean>;
}

export async function deleteAccountWithProof({
  client,
  receiptKey,
  isCurrent,
  authorize,
}: Options) {
  try {
    return await client.accountDeletion.delete({ receiptKey });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== ErrorCode.REAUTH_REQUIRED) throw error;
    if (!isCurrent() || !(await authorize(error, isCurrent)) || !isCurrent()) return undefined;
    return client.accountDeletion.delete({ receiptKey });
  }
}
