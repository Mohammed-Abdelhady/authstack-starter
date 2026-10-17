/**
 * Object Validators
 *
 * Collection of object validation schemas.
 *
 * @module validations/object
 */

import { z } from 'zod/v3';

/**
 * Generic object validator factory
 * @example
 * zodObject({ name: z.string(), age: z.number() })
 */
export const zodObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape);

/**
 * Partial object validator factory (all fields optional)
 * @example
 * zodPartialObject({ name: z.string(), age: z.number() })
 */
export const zodPartialObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial();

/**
 * Strict object validator factory (no extra keys)
 * @example
 * zodStrictObject({ name: z.string() })
 */
export const zodStrictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
