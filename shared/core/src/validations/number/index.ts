/**
 * Number Validators
 *
 * Collection of number validation schemas. Every message comes from the caller
 * so the schema reads in the active locale.
 *
 * @module validations/number
 */

import { z } from 'zod/v3';
import { makeOptional, createNumberValidator, createNumberInRange } from '../utils';

interface RangeMessages {
  integer: string;
  min: string;
  max: string;
}

/**
 * Generic number validator
 */
export const zodNumber = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: {
    required: string;
    invalid: string;
    finite: string;
    min: string;
    max: string;
  };
}) => {
  let schema = z
    .number({
      required_error: options.messages.required,
      invalid_type_error: options.messages.invalid,
    })
    .finite(options.messages.finite);

  if (options.min !== undefined) {
    schema = schema.min(options.min, options.messages.min);
  }
  if (options.max !== undefined) {
    schema = schema.max(options.max, options.messages.max);
  }

  return makeOptional(schema, options.required);
};

// Simple number validators using utility
export const zodPositiveNumber = (options: { required?: boolean; message: string }) =>
  createNumberValidator('positive', options);

export const zodNegativeNumber = (options: { required?: boolean; message: string }) =>
  createNumberValidator('negative', options);

export const zodInteger = (options: { required?: boolean; message: string }) =>
  createNumberValidator('int', options);

export const zodFloat = (options: { required?: boolean; message: string }) =>
  createNumberValidator('finite', options);

/**
 * Percentage validator (0-100)
 */
export const zodPercentage = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: {
    integer: string;
    min: string;
    max: string;
  };
}) => createNumberInRange(0, 100, { ...options, integer: false });

/**
 * Price validator (currency with 2 decimals)
 */
export const zodPrice = (options: {
  required?: boolean;
  messages: {
    nonNegative: string;
    decimals: string;
  };
}) => {
  const schema = z
    .number()
    .nonnegative(options.messages.nonNegative)
    .multipleOf(0.01, options.messages.decimals);

  return makeOptional(schema, options.required);
};

// Age validator (0-150)
export const zodAge = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: RangeMessages;
}) => createNumberInRange(0, 150, options);

// Year validator (1900 to current year + 10)
export const zodYear = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: RangeMessages;
}) => createNumberInRange(1900, new Date().getFullYear() + 10, options);

// Month validator (1-12)
export const zodMonth = (options: { required?: boolean; messages: RangeMessages }) =>
  createNumberInRange(1, 12, options);

// Day validator (1-31)
export const zodDay = (options: { required?: boolean; messages: RangeMessages }) =>
  createNumberInRange(1, 31, options);

// Rating validator (1-5 stars)
export const zodRating = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: RangeMessages;
}) => createNumberInRange(1, 5, options);
