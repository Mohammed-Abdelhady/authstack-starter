/**
 * Array Validators
 *
 * Collection of array validation schemas. Every message comes from the caller
 * so the schema reads in the active locale.
 *
 * @module validations/array
 */

import { z } from 'zod/v3';

/**
 * Generic array validator factory
 * @example
 * zodArray(z.string(), { required: t('required'), invalid: t('mustBeList') }).min(1).max(10)
 */
export const zodArray = <T extends z.ZodTypeAny>(
  schema: T,
  messages: { required: string; invalid: string },
) =>
  z.array(schema, {
    required_error: messages.required,
    invalid_type_error: messages.invalid,
  });

/**
 * Non-empty array validator factory
 * @example
 * zodNonEmptyArray(z.string(), t('atLeastOneItem'))
 */
export const zodNonEmptyArray = <T extends z.ZodTypeAny>(schema: T, message: string) =>
  z.array(schema).nonempty(message);

/**
 * String array validator
 * @example
 * zodStringArray.parse(['a', 'b', 'c']) // valid
 */
export const zodStringArray = z.array(z.string());

/**
 * Number array validator
 * @example
 * zodNumberArray.parse([1, 2, 3]) // valid
 */
export const zodNumberArray = z.array(z.number());

/**
 * Unique array validator factory (no duplicates)
 * @example
 * zodUniqueArray(z.string(), t('itemsMustBeUnique'))
 */
export const zodUniqueArray = <T extends z.ZodTypeAny>(schema: T, message: string) =>
  z.array(schema).refine((arr) => new Set(arr).size === arr.length, { message });

/**
 * Object array validator factory
 * @example
 * zodObjectArray(z.object({ id: z.number(), name: z.string() }))
 */
export const zodObjectArray = <T extends z.ZodTypeAny>(schema: T) => z.array(schema);

/**
 * Enum array validator factory
 * @example
 * zodEnumArray(z.enum(['a', 'b', 'c']))
 */
export const zodEnumArray = <T extends z.ZodTypeAny>(schema: T) => z.array(schema);

/**
 * Tuple validator (fixed-length typed array)
 * @example
 * zodTuple([z.string(), z.number()])
 */
export const zodTuple = <T extends [z.ZodTypeAny, ...z.ZodTypeAny[]]>(schemas: T) =>
  z.tuple(schemas);
