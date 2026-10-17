import { z } from 'zod/v3';
import { ErrorCode } from '@app/core';
import type { DisableTwoFactorRequest } from '../types';
import { createAnswerSchema, toAnswer, type AnswerFormData } from './answerSchema';

export type DisableFormData = AnswerFormData & { password?: string };

export type DisableField = 'password' | 'code' | 'recoveryCode';

type DisableSchema = z.ZodType<DisableFormData, z.ZodTypeDef, DisableFormData>;

/**
 * The answer schema, plus the password for an account that has one. A key the
 * schema does not name is dropped by the resolver before the submit handler
 * runs, so the password has to be named here to reach the request.
 *
 * @param passwordRequired - The message for an empty password, or undefined
 *   when the account has no password and the form shows no such field
 */
export function createDisableSchema(
  t: (key: string) => string,
  passwordRequired: string | undefined,
): DisableSchema {
  const answer = createAnswerSchema(t);
  if (passwordRequired === undefined) {
    return answer;
  }
  return answer.and(z.object({ password: z.string().min(1, passwordRequired) }));
}

/** The request body: the answer, and the password only when the form has one. */
export function toDisableRequest(data: DisableFormData): DisableTwoFactorRequest {
  const answer = toAnswer(data);
  return data.password === undefined ? answer : { ...answer, password: data.password };
}

const PASSWORD_CODES = new Set<string>([
  ErrorCode.INVALID_CURRENT_PASSWORD,
  ErrorCode.REAUTH_REQUIRED,
]);

/**
 * The field a refusal is about, or null when it is about none of them. The
 * server checks the password first and answers with a different code for each.
 */
export function refusedField(
  errorCode: string,
  request: DisableTwoFactorRequest,
): DisableField | null {
  if (PASSWORD_CODES.has(errorCode)) {
    return request.password === undefined ? null : 'password';
  }
  if (errorCode === ErrorCode.TWO_FACTOR_CODE_INVALID) {
    return request.code === undefined ? 'recoveryCode' : 'code';
  }
  return null;
}
