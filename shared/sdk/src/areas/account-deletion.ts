import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import { malformedResponse } from '../envelope';
import { unwrapObject } from '../shapes';
import type { TransportSignal } from '../transport';
import { pathSegment } from './path-segment';
import type { AreaSenders } from './shared';

export const ACCOUNT_DELETION_PATHS = {
  account: '/api/user/account',
  receipt: (key: string) => `/api/auth/account-deletion/${pathSegment(key, 'receipt key')}`,
} as const;
export const DELETION_RECEIPT_STATE = {
  RECORDED: 'recorded',
  NOT_RECORDED: 'not_recorded',
  UNKNOWN: 'unknown',
} as const;
export type DeletionReceiptState =
  (typeof DELETION_RECEIPT_STATE)[keyof typeof DELETION_RECEIPT_STATE];
export const DELETION_RECEIPT_KEY_PATTERN = /^r1\.(\d{1,15})\.([0-9a-f]{64})$/;
export const DELETION_RECEIPT_RANDOM_BYTES = 32;

export function deletionReceiptKey(issuedAt: number, random: Uint8Array): string {
  if (
    random.length !== DELETION_RECEIPT_RANDOM_BYTES ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0
  ) {
    throw new RangeError('A receipt needs a non-negative safe time and 32 random bytes');
  }
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `r1.${issuedAt}.${hex}`;
}

export function deletionReceiptIssuedAt(key: string): number | null {
  const match = DELETION_RECEIPT_KEY_PATTERN.exec(key);
  return match === null ? null : Number(match[1]);
}

export interface AccountDeletionResult {
  message: string;
  eraseAfter?: string;
}
export interface DeletionReceipt {
  state: DeletionReceiptState;
}
export interface ApiClientAccountDeletion<TSignal extends TransportSignal = TransportSignal> {
  accountDeletion: {
    delete(
      input: { receiptKey?: string },
      options?: CallOptions<TSignal>,
    ): Promise<AccountDeletionResult>;
    receipt(key: string, options?: CallOptions<TSignal>): Promise<DeletionReceipt>;
  };
}

export function createAccountDeletionArea<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientAccountDeletion<TSignal> {
  return {
    accountDeletion: {
      delete: (input, options) =>
        sendObject(
          { method: HTTP_METHOD.DELETE, path: ACCOUNT_DELETION_PATHS.account, body: input },
          options,
        ),
      receipt: async (key, options) => {
        const response = await send(
          { method: HTTP_METHOD.GET, path: ACCOUNT_DELETION_PATHS.receipt(key) },
          options,
        );
        const data = unwrapObject<{ state?: unknown }>(response);
        const state = Object.values(DELETION_RECEIPT_STATE).find((value) => value === data.state);
        if (state === undefined)
          throw malformedResponse(response.status, 'The deletion receipt state is invalid');
        return { state };
      },
    },
  };
}
