/**
 * Special Validators
 *
 * Collection of special-purpose validation schemas (enum, union, literal, etc.).
 *
 * @module validations/special
 */

import { z } from 'zod/v3';

/**
 * Enum validator factory
 * @example
 * zodEnum(['admin', 'user'])
 */
export const zodEnum = <T extends [string, ...string[]]>(values: T) => z.enum(values);

/**
 * Literal validator factory (exact value match)
 * @example
 * zodLiteral('exact-value')
 */
export const zodLiteral = <T extends z.Primitive>(value: T) => z.literal(value);

/**
 * Nullable validator factory (allows null)
 * @example
 * zodNullable(z.string())
 */
export const zodNullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullable();

/**
 * Optional validator factory (allows undefined)
 * @example
 * zodOptional(z.string())
 */
export const zodOptional = <T extends z.ZodTypeAny>(schema: T) => schema.optional();

/**
 * Nullish validator factory (allows null or undefined)
 * @example
 * zodNullish(z.string())
 */
export const zodNullish = <T extends z.ZodTypeAny>(schema: T) => schema.nullish();

/**
 * Union validator factory (one of multiple schemas)
 * @example
 * zodUnion([z.string(), z.number()])
 */
export const zodUnion = <T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>(
  schemas: T,
) => z.union([...schemas] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);

/**
 * Record validator factory (key-value map)
 * @example
 * zodRecord(z.string(), z.number())
 */
export const zodRecord = <K extends z.ZodTypeAny, V extends z.ZodTypeAny>(
  keySchema: K,
  valueSchema: V,
) => z.record(keySchema, valueSchema);

/**
 * Discriminated union validator factory (tagged unions)
 * @example
 * zodDiscriminatedUnion('type', [
 *   z.object({ type: z.literal('a'), value: z.string() }),
 *   z.object({ type: z.literal('b'), value: z.number() })
 * ])
 */
export const zodDiscriminatedUnion = <
  K extends string,
  T extends readonly [z.ZodDiscriminatedUnionOption<K>, ...z.ZodDiscriminatedUnionOption<K>[]],
>(
  discriminator: K,
  options: T,
) =>
  z.discriminatedUnion(discriminator, [...options] as [
    z.ZodDiscriminatedUnionOption<K>,
    ...z.ZodDiscriminatedUnionOption<K>[],
  ]);
