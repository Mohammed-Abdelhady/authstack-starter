/**
 * Composed Validators
 *
 * Complex validators composed from multiple base validators. Every message comes
 * from the caller so the schema reads in the active locale.
 *
 * @module validations/composed
 */

import { z } from 'zod/v3';
import { zodPassword, type PasswordMessages } from '../string';

/**
 * Password with confirmation validator
 * @example
 * zodPasswordWithConfirm({ min: 10, messages }).parse({ password: 'Test1234!', confirmPassword: 'Test1234!' })
 */
export const zodPasswordWithConfirm = (options: {
  min?: number;
  messages: PasswordMessages & { match: string };
}) =>
  z
    .object({
      password: zodPassword({ required: true, min: options.min, messages: options.messages }),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: options.messages.match,
      path: ['confirmPassword'],
    });
