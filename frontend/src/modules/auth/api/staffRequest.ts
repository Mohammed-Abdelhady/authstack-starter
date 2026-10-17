import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { unwrapObjectBody } from '@app/sdk';
import { proofErrorKey, isProofRefusal } from '../utils/staffErrors';
import { serializeSdkError } from '@/store/api/sdk-errors';
import { HTTP_STATUS } from '@/constants/httpStatus';

const unwrap = <T extends object>(response: unknown): T => unwrapObjectBody<T>(response);
type StaffFetch = (
  args: string | FetchArgs,
) => ReturnType<BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError>>;

export async function staffRequest<T extends object>(
  args: FetchArgs,
  fetch: StaffFetch,
  read: (body: unknown) => T = unwrap<T>,
) {
  const result = await fetch(args);
  if (!result.error) {
    try {
      return { data: read(result.data) };
    } catch (failure) {
      return { error: { ...serializeSdkError(failure), unknownOutcome: true } };
    }
  }
  const error = result.error;
  const key = proofErrorKey(error);
  // These 401s request proof within the live session, so they must not start a session reset.
  if (error.status === HTTP_STATUS.UNAUTHORIZED && isProofRefusal(error)) {
    return {
      error: {
        status: 'CUSTOM_ERROR' as const,
        data: error.data,
        error: key,
        unknownOutcome: false,
      },
    };
  }
  return { error };
}
