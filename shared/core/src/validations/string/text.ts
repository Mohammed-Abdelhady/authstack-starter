/**
 * Free Text Validators
 *
 * Plain strings, textareas and long-form content. Every message comes from the
 * caller so the schema reads in the active locale.
 *
 * @module validations/string/text
 */

import { z } from 'zod/v3';
import { makeOptional } from '../utils';

/**
 * Generic string validator with configurable min/max length
 */
export const zodString = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: {
    required: string;
    invalidType: string;
    min: string;
    max: string;
  };
}) => {
  let schema = z.string({
    required_error: options.messages.required,
    invalid_type_error: options.messages.invalidType,
  });

  if (options.min !== undefined) {
    schema = schema.min(options.min, options.messages.min);
  }
  if (options.max !== undefined) {
    schema = schema.max(options.max, options.messages.max);
  }

  return makeOptional(schema, options.required);
};

/**
 * String validator that automatically trims whitespace
 */
export const zodTrimmedString = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: {
    required: string;
  };
}) => {
  let schema = z.string().trim();

  if (options.required !== false) {
    schema = schema.min(1, options.messages.required);
  }
  if (options.min !== undefined) {
    schema = schema.min(options.min);
  }
  if (options.max !== undefined) {
    schema = schema.max(options.max);
  }

  return makeOptional(schema, options.required);
};

/**
 * Search query validator (1-100 chars)
 */
export const zodSearchQuery = (options: {
  required?: boolean;
  max?: number;
  messages: {
    required: string;
    max: string;
  };
}) => {
  const schema = z
    .string()
    .trim()
    .min(1, options.messages.required)
    .max(options.max ?? 100, options.messages.max);

  return makeOptional(schema, options.required);
};

/**
 * Textarea validator (configurable length)
 */
export const zodTextarea = (options: {
  required?: boolean;
  min?: number;
  max?: number;
  messages: {
    required: string;
    min: string;
    max: string;
  };
}) => {
  let schema = z.string().trim();

  if (options.required !== false) {
    schema = schema.min(1, options.messages.required);
  }
  if (options.min !== undefined) {
    schema = schema.min(options.min, options.messages.min);
  }
  if (options.max !== undefined) {
    schema = schema.max(options.max, options.messages.max);
  }

  return makeOptional(schema, options.required);
};

/**
 * Rich text/HTML content validator
 */
export const zodRichText = (options: {
  required?: boolean;
  max?: number;
  messages: {
    required: string;
    max: string;
  };
}) => {
  const schema = z
    .string()
    .min(1, options.messages.required)
    .max(options.max ?? 50000, options.messages.max);

  return makeOptional(schema, options.required);
};

/**
 * Markdown content validator
 */
export const zodMarkdown = (options: {
  required?: boolean;
  max?: number;
  messages: {
    required: string;
    max: string;
  };
}) => {
  const schema = z
    .string()
    .min(1, options.messages.required)
    .max(options.max ?? 10000, options.messages.max);

  return makeOptional(schema, options.required);
};

export const zodOptionalString = () => z.string().optional();
