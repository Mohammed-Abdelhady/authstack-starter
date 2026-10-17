/**
 * Boolean Validators
 *
 * Collection of boolean validation schemas. Every message comes from the caller
 * so the schema reads in the active locale.
 *
 * @module validations/boolean
 */

import { z } from 'zod/v3';

/**
 * Boolean validator
 * @example
 * zodBoolean({ required: false, messages: { required: t('required'), invalid: t('invalid') } })
 */
export const zodBoolean = (options: {
  required?: boolean;
  messages: {
    required: string;
    invalid: string;
  };
}) => {
  const schema = z.boolean({
    required_error: options.messages.required,
    invalid_type_error: options.messages.invalid,
  });

  return options.required === false ? schema.optional() : schema;
};

/**
 * Accept terms validator (must be true)
 * @example
 * zodAcceptTerms({ message: t('mustAcceptTerms') })
 */
export const zodAcceptTerms = (options: { message: string }) =>
  z.literal(true, { errorMap: () => ({ message: options.message }) });
