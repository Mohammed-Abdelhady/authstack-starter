import { z } from 'zod/v3';
import { RECOVERY_CODE_LENGTH, TOTP_CODE_LENGTH } from '../constants';
import type { TwoFactorAnswer } from '../types';

const CODE_PATTERN = new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`);

/**
 * One schema for both ways of answering a challenge. Which field is on screen
 * is a matter of the toggle; the empty one is simply ignored here.
 */
export function createAnswerSchema(t: (key: string) => string) {
  return z
    .object({
      code: z.string().optional(),
      recoveryCode: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      const code = value.code?.trim() ?? '';
      const recoveryCode = value.recoveryCode?.trim() ?? '';

      if (code.length === 0 && recoveryCode.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['code'], message: t('answerRequired') });
        return;
      }
      if (code.length > 0 && !CODE_PATTERN.test(code)) {
        ctx.addIssue({ code: 'custom', path: ['code'], message: t('codeLength') });
      }
      if (recoveryCode.length > 0 && recoveryCode.length < RECOVERY_CODE_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['recoveryCode'],
          message: t('recoveryCodeLength'),
        });
      }
    });
}

export type AnswerFormData = z.infer<ReturnType<typeof createAnswerSchema>>;

/** Sends only the field that was filled in, as the backend expects. */
export function toAnswer(data: AnswerFormData): TwoFactorAnswer {
  const code = data.code?.trim() ?? '';
  return code.length > 0 ? { code } : { recoveryCode: data.recoveryCode?.trim() };
}
