/**
 * Pattern String Validators
 *
 * Formats checked with a regex or a built-in zod rule. Every message comes from
 * the caller so the schema reads in the active locale.
 *
 * @module validations/string/patterns
 */

import { z } from 'zod/v3';
import { makeOptional, createStringValidator } from '../utils';

/**
 * URL validator (HTTP/HTTPS only)
 */
export const zodUrl = (options: {
  required?: boolean;
  messages: {
    invalid: string;
    protocol: string;
  };
}) => {
  const schema = z
    .string()
    .url(options.messages.invalid)
    .regex(/^https?:\/\//, options.messages.protocol);

  return makeOptional(schema, options.required);
};

/**
 * URL-safe slug validator (lowercase, hyphens)
 */
export const zodSlug = (options: {
  required?: boolean;
  max?: number;
  messages: {
    required: string;
    max: string;
    pattern: string;
  };
}) => {
  const schema = z
    .string()
    .trim()
    .toLowerCase()
    .min(1, options.messages.required)
    .max(options.max ?? 100, options.messages.max)
    .regex(/^[a-z0-9-]+$/, options.messages.pattern);

  return makeOptional(schema, options.required);
};

export const zodHexColor = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, options);

export const zodUuid = (options: { required?: boolean; message: string }) =>
  makeOptional(z.string().uuid(options.message), options.required);

export const zodIpAddress = (options: { required?: boolean; message: string }) =>
  makeOptional(z.string().ip(options.message), options.required);

export const zodPhoneNumber = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^\+?[1-9]\d{1,14}$/, options);

export const zodPostalCode = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^\d{5}(-\d{4})?$/, options);

export const zodCreditCard = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^\d{13,19}$/, options);

export const zodBase64 = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^[A-Za-z0-9+/]+=*$/, options);

export const zodAlphanumeric = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^[a-zA-Z0-9]+$/, options);

export const zodLowercase = (options: { required?: boolean; message: string }) =>
  makeOptional(
    z
      .string()
      .toLowerCase()
      .regex(/^[a-z]+$/, options.message),
    options.required,
  );

export const zodUppercase = (options: { required?: boolean; message: string }) =>
  makeOptional(
    z
      .string()
      .toUpperCase()
      .regex(/^[A-Z]+$/, options.message),
    options.required,
  );

/**
 * JSON string validator
 */
export const zodJson = (options: { required?: boolean; message: string }) => {
  const schema = z.string().refine(
    (val) => {
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: options.message },
  );

  return makeOptional(schema, options.required);
};
