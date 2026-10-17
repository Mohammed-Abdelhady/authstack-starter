import { z } from 'zod/v3';
import { zodEmail } from '@app/core';
import { VERIFICATION_CODE_LENGTH, AUTH_EMAIL_MAX_LENGTH } from '../constants/authMethods';

export const createEmailCodeSchema = (t: (key: string) => string) =>
  z.object({
    email: zodEmail({
      required: true,
      messages: { required: t('errors.emailRequired'), invalid: t('errors.emailInvalid') },
    }).max(AUTH_EMAIL_MAX_LENGTH, t('errors.emailInvalid')),
    code: z
      .string({ required_error: t('errors.codeRequired') })
      .trim()
      .length(VERIFICATION_CODE_LENGTH, t('errors.codeLength'))
      .regex(/^\d{6}$/, t('errors.codeInvalid')),
  });
