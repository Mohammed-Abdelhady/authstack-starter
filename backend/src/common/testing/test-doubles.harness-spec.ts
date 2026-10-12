import { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Test doubles for the collaborator types Nest and Express hand to guards,
 * filters, interceptors, controllers and services.
 *
 * This file holds the single deliberate unchecked assertion in the test
 * suite support (`asFullType`): a double records only the members a spec
 * drives and is asserted to be the full collaborator type. That is
 * acceptable in tests only — production code always receives real
 * collaborators — which is why the assertion lives here and nowhere else,
 * and why every other helper routes through it. The file uses the
 * `.harness-spec.ts` suffix: it is excluded from the production build and
 * Jest does not run it as a suite of its own.
 */

/**
 * The one place a partial test double is asserted to be the full collaborator
 * type. Nothing outside this function asserts; every double below is built
 * on it.
 */
function asFullType<T extends object>(value: object): T {
  return value as T;
}

/**
 * A double typed as `T`, carrying only what the spec drives. The overrides
 * ("what it really is") are checked against `Partial<T>`, which is the
 * claimed type the double cannot honestly fulfil on its own.
 */
export function partialMock<T extends object>(overrides: Partial<T> = {}): T {
  return asFullType<T>(Object.assign({}, overrides));
}

/**
 * A mongoose model double: callable and newable the way the module injects
 * the real model. It shares the one assertion above because `partialMock`
 * seeds a plain object and a model double needs a constructable base.
 */
export function createModelMock<M extends object>(methods: Partial<M> = {}): M {
  return asFullType<M>(Object.assign(jest.fn(), methods));
}

/** A Request double. Overlay what the spec records on: `{ cookies: ... }`. */
export function createRequestMock<M extends object>(overrides: M): Request & M {
  return Object.assign(partialMock<Request>({}), overrides);
}

/** A Response double. Overlay the methods the spec asserts on. */
export function createResponseMock<M extends object>(
  overrides: M,
): Response & M {
  return Object.assign(partialMock<Response>({}), overrides);
}

/** An ExecutionContext double for a guard or interceptor under test. */
export function createExecutionContextMock<M extends object>(
  overrides: M,
): ExecutionContext & M {
  return Object.assign(partialMock<ExecutionContext>({}), overrides);
}

/** An ArgumentsHost double for a filter under test. */
export function createArgumentsHostMock<M extends object>(
  overrides: M,
): ArgumentsHost & M {
  return Object.assign(partialMock<ArgumentsHost>({}), overrides);
}

/**
 * The chainable calls a Mongoose query answers before `exec()` resolves it.
 * Overlay a method to change one link of the chain.
 */
interface ChainableQueryMock {
  session: jest.Mock;
  exec: jest.Mock;
}

/** A Mongoose query double: every chainable call returns itself, `exec` resolves. */
export function createChainableQueryMock<T>(result: T): ChainableQueryMock {
  const query: ChainableQueryMock = {
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  query.session.mockReturnValue(query);
  return query;
}

/** A handler of a route as a plain function, which is what carries metadata. */
export type RouteHandler = (...args: never[]) => unknown;

/** Reads the handler off a controller prototype without asserting the shape. */
export function handlerOf(prototype: object, name: string): RouteHandler {
  const handler: RouteHandler = Reflect.get(prototype, name);
  return handler;
}
