import type { Request, Response } from 'express';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { NewSecurityEvent } from '../../../../src/session/events/security-event.store';
import { TEST_NOW } from '../../frozen-clock';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import { ProofsEventsContractHarness } from './proofs-events-contract-harness';

export { rejectionOf } from '../issuance-contract/issuance-contract-support';

export type HarnessSource = () => ProofsEventsContractHarness;

/** The cookie the server reads outside production, written out by hand. */
export const PROOF_COOKIE = 'bp';
/** Fifteen minutes, written out so a changed constant cannot agree with itself. */
export const PROOF_LIFETIME_MS = 900_000;

export const NOW = TEST_NOW;
export const ONE_MS_BEFORE = new Date('2099-01-01T11:59:59.999Z');
export const ONE_MS_AFTER = new Date('2099-01-01T12:00:00.001Z');

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
export const HASH_C = 'c'.repeat(64);
export const TOKEN_HASH = 'd'.repeat(64);

export function requestWith(proofId: string | undefined): Request {
  const request: Partial<Request> = {
    cookies: proofId === undefined ? {} : { [PROOF_COOKIE]: proofId },
  };
  return request as Request;
}

export interface CapturedCookie {
  name: string;
  value: string;
}

/** A response that keeps the cookies set on it. */
export function responseCapturing(
  cookies: CapturedCookie[],
  request?: Request,
): Response {
  const response: Partial<Response> = { req: request };
  response.cookie = (name: string, value: string) => {
    cookies.push({ name, value });
    return response as Response;
  };
  return response as Response;
}

export function inUnitOfWork<Result>(
  harness: ProofsEventsContractHarness,
  work: (unitOfWork: UnitOfWork) => Promise<Result>,
): Promise<Result> {
  return harness.runner(rerunAtOnce).run(work);
}

/** An event with every plain field set, at a fixed instant. */
export function contractEvent(
  eventId: string,
  overrides: Partial<NewSecurityEvent> = {},
): NewSecurityEvent {
  return {
    eventId,
    action: 'contract.event',
    outcome: 'succeeded',
    occurredAt: NOW,
    ...overrides,
  };
}

export function codeOf(failure: unknown): unknown {
  return failure instanceof Error ? Reflect.get(failure, 'code') : failure;
}
