/**
 * Date & Time Validators
 *
 * Collection of date and time validation schemas. Every message comes from the
 * caller so the schema reads in the active locale.
 *
 * @module validations/date
 */

import { z } from 'zod/v3';
import { makeOptional, createDateValidator, createStringValidator } from '../utils';

/**
 * Date validator
 */
export const zodDate = (options: {
  required?: boolean;
  messages: {
    required: string;
    invalid: string;
  };
}) => {
  const schema = z.date({
    required_error: options.messages.required,
    invalid_type_error: options.messages.invalid,
  });

  return makeOptional(schema, options.required);
};

/**
 * Future date validator (must be after today)
 */
export const zodFutureDate = (options: { required?: boolean; message: string }) =>
  createDateValidator((date) => date > new Date(), options);

/**
 * Past date validator (must be before today)
 */
export const zodPastDate = (options: { required?: boolean; message: string }) =>
  createDateValidator((date) => date < new Date(), options);

/**
 * Date range validator factory
 */
export const zodDateRange = (
  min: Date,
  max: Date,
  options: {
    required?: boolean;
    messages: {
      min: string;
      max: string;
    };
  },
) => {
  const schema = z.date().min(min, options.messages.min).max(max, options.messages.max);

  return makeOptional(schema, options.required);
};

/**
 * Time validator (HH:MM format)
 */
export const zodTime = (options: { required?: boolean; message: string }) =>
  createStringValidator(/^([01]\d|2[0-3]):([0-5]\d)$/, options);

/**
 * DateTime validator (ISO 8601 format)
 */
export const zodDateTime = (options: { required?: boolean; message: string }) =>
  makeOptional(z.string().datetime(options.message), options.required);

/**
 * Unix timestamp validator
 */
export const zodTimestamp = (options: {
  required?: boolean;
  messages: {
    integer: string;
    positive: string;
  };
}) => {
  const schema = z.number().int(options.messages.integer).positive(options.messages.positive);

  return makeOptional(schema, options.required);
};
