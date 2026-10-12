import { NATIVE_AUTH_LIMITS } from '@app/core';

const BASE_PATH = '/api/auth/native';

function pathSegment(value: string, name: string, maxLength: number): string {
  if (value.length === 0 || value.length > maxLength || value === '.' || value === '..') {
    throw new TypeError(`${name} is not a safe path segment`);
  }
  return encodeURIComponent(value);
}

function attemptPath(attemptId: string): string {
  const id = pathSegment(attemptId, 'attempt id', NATIVE_AUTH_LIMITS.ATTEMPT_ID);
  return `${BASE_PATH}/attempts/${id}`;
}

export const NATIVE_AUTH_PATHS = {
  methods(clientId: string): string {
    const id = pathSegment(clientId, 'client id', NATIVE_AUTH_LIMITS.CLIENT_ID);
    return `${BASE_PATH}/methods?clientId=${id}`;
  },
  attempts: `${BASE_PATH}/attempts`,
  password: (attemptId: string) => `${attemptPath(attemptId)}/password`,
  provider: (attemptId: string) => `${attemptPath(attemptId)}/provider`,
  passkeyOptions: (attemptId: string) => `${attemptPath(attemptId)}/passkey/options`,
  passkeyVerify: (attemptId: string) => `${attemptPath(attemptId)}/passkey/verify`,
  secondFactor: (attemptId: string) => `${attemptPath(attemptId)}/second-factor`,
  requestEmailLink: (attemptId: string) => `${attemptPath(attemptId)}/email-link/request`,
  verifyEmailLink: (attemptId: string) => `${attemptPath(attemptId)}/email-link/verify`,
  register: (attemptId: string) => `${attemptPath(attemptId)}/register`,
  activate: (attemptId: string) => `${attemptPath(attemptId)}/activate`,
  requestRecovery: (attemptId: string) => `${attemptPath(attemptId)}/recovery/request`,
  confirmRecovery: (attemptId: string) => `${attemptPath(attemptId)}/recovery/confirm`,
  consent: (attemptId: string) => `${attemptPath(attemptId)}/consent`,
  cancel: (attemptId: string) => `${attemptPath(attemptId)}/cancel`,
} as const;
