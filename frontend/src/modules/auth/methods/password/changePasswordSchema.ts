import { z } from 'zod/v3';
import { createPasswordSchema } from '@/modules/auth/utils/passwordSchema';

// The shared change schema does not accept a localized byte-limit message yet.
export function createChangePasswordSchema(
  t: (key: string) => string,
  tPassword: (key: string) => string,
) {
  return z
    .object({
      currentPassword: z
        .string({ required_error: t('currentPasswordRequired') })
        .min(1, t('currentPasswordRequired')),
      newPassword: createPasswordSchema(tPassword),
      confirmPassword: z
        .string({ required_error: t('confirmPasswordRequired') })
        .min(1, t('confirmPasswordRequired')),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: t('passwordsDoNotMatch'),
      path: ['confirmPassword'],
    });
}
