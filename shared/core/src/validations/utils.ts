/**
 * Validation Utilities
 *
 * Reusable helper functions for creating dynamic validators.
 *
 * Every message is supplied by the caller. The validators carry no English
 * text of their own, so a form in any locale reads its messages from the
 * translation files instead of falling back to the library.
 *
 * @module validations/utils
 */

import { z } from 'zod/v3';

/**
 * Make a schema optional based on the required flag
 * Returns exact type based on required parameter for better TypeScript inference
 */
export function makeOptional<T extends z.ZodTypeAny>(schema: T, required: false): z.ZodOptional<T>;
export function makeOptional<T extends z.ZodTypeAny>(schema: T, required?: true): T;
export function makeOptional<T extends z.ZodTypeAny>(schema: T, required?: boolean): T;
export function makeOptional<T extends z.ZodTypeAny>(
  schema: T,
  required?: boolean,
): T | z.ZodOptional<T> {
  return required === false ? schema.optional() : schema;
}

/**
 * Create a simple string validator with regex pattern
 */
export const createStringValidator = (
  pattern: RegExp,
  options: { required?: boolean; message: string },
) => {
  const schema = z.string().regex(pattern, options.message);
  return makeOptional(schema, options.required);
};

/**
 * Create a string validator with min/max and optional regex
 */
export const createBoundedString = (
  defaultMin: number,
  defaultMax: number,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: RegExp;
    messages: {
      min: string;
      max: string;
      pattern: string;
    };
  },
) => {
  const min = options.min ?? defaultMin;
  const max = options.max ?? defaultMax;

  let schema = z.string().trim().min(min, options.messages.min).max(max, options.messages.max);

  if (options.pattern) {
    schema = schema.regex(options.pattern, options.messages.pattern);
  }

  return makeOptional(schema, options.required);
};

/**
 * Create a number validator with range
 */
export const createNumberInRange = (
  defaultMin: number,
  defaultMax: number,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
    messages: {
      integer: string;
      min: string;
      max: string;
    };
  },
) => {
  const min = options.min ?? defaultMin;
  const max = options.max ?? defaultMax;

  let schema = z.number();

  if (options.integer !== false) {
    schema = schema.int(options.messages.integer);
  }

  schema = schema.min(min, options.messages.min).max(max, options.messages.max);

  return makeOptional(schema, options.required);
};

/**
 * Create a simple number validator
 */
export const createNumberValidator = (
  method: 'positive' | 'negative' | 'nonnegative' | 'int' | 'finite',
  options: { required?: boolean; message: string },
) => {
  const schema = z.number()[method](options.message);
  return makeOptional(schema, options.required);
};

/**
 * Create a date validator with refine
 */
export const createDateValidator = (
  refineFn: (date: Date) => boolean,
  options: { required?: boolean; message: string },
) => {
  const schema = z.date().refine(refineFn, { message: options.message });
  return makeOptional(schema, options.required);
};
