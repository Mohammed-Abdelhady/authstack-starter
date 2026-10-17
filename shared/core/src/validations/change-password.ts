/**
 * Change Password Validation Schema
 *
 * Validates the change password form with:
 * - Current password (required)
 * - New password (8+ chars, uppercase, lowercase, number)
 * - Confirm password (must match new password)
 */

import { z } from 'zod/v3';
import { zodPassword } from './string';

export const createChangePasswordSchema = (t: (key: string) => string) =>
  z
    .object({
      currentPassword: z
        .string({ required_error: t('currentPasswordRequired') })
        .min(1, t('currentPasswordRequired')),
      newPassword: zodPassword({
        required: true,
        min: 8,
        messages: {
          required: t('newPasswordRequired'),
          min: t('newPasswordMin'),
          uppercase: t('newPasswordUppercase'),
          lowercase: t('newPasswordLowercase'),
          number: t('newPasswordNumber'),
        },
      }),
      confirmPassword: z
        .string({ required_error: t('confirmPasswordRequired') })
        .min(1, t('confirmPasswordRequired')),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: t('passwordsDoNotMatch'),
      path: ['confirmPassword'],
    });

export type ChangePasswordFormData = z.infer<ReturnType<typeof createChangePasswordSchema>>;
