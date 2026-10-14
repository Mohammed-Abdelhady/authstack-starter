/**
 * Identity String Validators
 *
 * Email, password and name rules behind the auth and account forms. Every
 * message comes from the caller so the schema reads in the active locale.
 *
 * @module validations/string/identity
 */

import { z } from 'zod';
import { makeOptional } from '../utils';
import { isPasswordWithinByteLimit } from '../../password-rules';

export interface EmailMessages {
  required: string;
  invalid: string;
}

export interface PasswordMessages {
  required: string;
  min: string;
  uppercase: string;
  lowercase: string;
  number: string;
  /** Localized "too long" text; falls back to a default when omitted. */
  tooLong?: string;
}

/** Fallback used when a caller has not localized the byte-limit message yet. */
const DEFAULT_PASSWORD_TOO_LONG_MESSAGE = 'Password is too long';

/** The name charset, shared with the server's NAME_REGEX. */
const NAME_ZONE_CHARS = /^[\p{L}\p{M}0-9 ’'.-]+$/u;

/** A name without a single letter is not a person name. */
const NAME_HAS_LETTER = /\p{L}/u;

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;

/** The name schema both forms consume; output is always the NFC string. */
type NameSchema = z.ZodType<string>;

/** The refined password schema, so the overloads match what is returned. */
type RefinedPasswordSchema = z.ZodEffects<z.ZodString, string, string>;

export interface NameMessages {
  required: string;
  min: string;
  max: string;
  pattern: string;
  /** For input with allowed characters but no letter; falls back to pattern. */
  noLetter?: string;
}

/**
 * Email validator (RFC 5322 compliant)
 * Returns required schema by default, optional when required: false
 */
export function zodEmail(options: {
  required?: false;
  messages: EmailMessages;
}): z.ZodOptional<z.ZodString>;
export function zodEmail(options: { required: true; messages: EmailMessages }): z.ZodString;
export function zodEmail(options: {
  required?: boolean;
  messages: EmailMessages;
}): z.ZodString | z.ZodOptional<z.ZodString>;
export function zodEmail(options: { required?: boolean; messages: EmailMessages }) {
  const schema = z
    .string({ required_error: options.messages.required })
    .trim()
    .toLowerCase()
    .min(1, options.messages.required)
    .email(options.messages.invalid);

  if (options.required === false) {
    return schema.optional();
  }
  return schema;
}

/**
 * Password validator (min 8 chars, uppercase, lowercase, number)
 * Returns required schema by default, optional when required: false
 */
export function zodPassword(options: {
  required?: false;
  min?: number | undefined;
  messages: PasswordMessages;
}): z.ZodOptional<RefinedPasswordSchema>;
export function zodPassword(options: {
  required: true;
  min?: number | undefined;
  messages: PasswordMessages;
}): RefinedPasswordSchema;
export function zodPassword(options: {
  required?: boolean;
  min?: number | undefined;
  messages: PasswordMessages;
}): RefinedPasswordSchema | z.ZodOptional<RefinedPasswordSchema>;
export function zodPassword(options: {
  required?: boolean;
  min?: number | undefined;
  messages: PasswordMessages;
}) {
  const schema = z
    .string({ required_error: options.messages.required })
    .min(1, options.messages.required)
    .min(options.min ?? 8, options.messages.min)
    .regex(/[A-Z]/, options.messages.uppercase)
    .regex(/[a-z]/, options.messages.lowercase)
    .regex(/\d/, options.messages.number)
    .refine((value) => isPasswordWithinByteLimit(value), {
      message: options.messages.tooLong ?? DEFAULT_PASSWORD_TOO_LONG_MESSAGE,
    });

  if (options.required === false) {
    return schema.optional();
  }
  return schema;
}

/** Trims and normalises to NFC before checking code points, matching NamePolicy. */
export function zodName(options: {
  required?: false;
  min?: number;
  max?: number;
  messages: NameMessages;
}): z.ZodOptional<NameSchema>;
export function zodName(options: {
  required: true;
  min?: number;
  max?: number;
  messages: NameMessages;
}): NameSchema;
export function zodName(options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: NameMessages;
}): NameSchema | z.ZodOptional<NameSchema> {
  const min = options.min ?? NAME_MIN_LENGTH;
  const max = options.max ?? NAME_MAX_LENGTH;

  const rule = z
    .string({ required_error: options.messages.required })
    .transform((value) => value.trim().normalize('NFC'))
    .refine((value) => Array.from(value).length >= 1, options.messages.required)
    .refine((value) => Array.from(value).length >= min, options.messages.min)
    .refine((value) => Array.from(value).length <= max, options.messages.max)
    .refine((value) => NAME_ZONE_CHARS.test(value), options.messages.pattern)
    .refine(
      (value) => NAME_HAS_LETTER.test(value),
      options.messages.noLetter ?? options.messages.pattern,
    );

  return makeOptional(rule, options.required);
}

/**
 * Username validator (3-20 alphanumeric + underscore)
 */
export const zodUsername = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: {
    min: string;
    max: string;
    pattern: string;
  };
}) => {
  const schema = z
    .string()
    .trim()
    .toLowerCase()
    .min(options.min ?? 3, options.messages.min)
    .max(options.max ?? 20, options.messages.max)
    .regex(/^[a-z0-9_]+$/, options.messages.pattern);

  return makeOptional(schema, options.required);
};
