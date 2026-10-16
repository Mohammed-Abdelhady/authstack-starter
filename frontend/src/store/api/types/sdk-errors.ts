import type { FetchBaseQueryError } from '@reduxjs/toolkit/query/react';

export type BrowserQueryError = FetchBaseQueryError & {
  code?: string;
  fields?: Record<string, string[]>;
  requestId?: string;
  operationKey?: string;
  unknownOutcome?: boolean;
};

export type BrowserQueryResult =
  { data: unknown; error?: never } | { data?: never; error: BrowserQueryError };
