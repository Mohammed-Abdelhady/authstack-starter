import { describe, expect, it } from 'vitest';
import { unwrapEnvelope, unwrapEnvelopeBody } from './envelope';
import { apiErrorFrom, respond } from './test-support';

describe('unwrapEnvelope', () => {
  it('preserves the erasure date from a credential-proven refusal for the client', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(
        respond(403, {
          success: false,
          error: {
            code: 'ACCOUNT_ERASURE_PENDING',
            message: 'Scheduled',
            details: { eraseAfter: '2026-11-01T00:00:00.000Z' },
          },
        }),
      ),
    );
    expect(error.details).toEqual({ eraseAfter: '2026-11-01T00:00:00.000Z' });
  });

  it('returns undefined for a success envelope without data', () => {
    expect(unwrapEnvelope(respond(200, { success: true }))).toBeUndefined();
  });

  it('carries status, code, message and request id from an error envelope', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(
        respond(404, {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or already revoked' },
          requestId: '3f1c1f0a-0f2c-4a3e-9b1e-2f5a6c7d8e90',
        }),
      ),
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe('SESSION_NOT_FOUND');
    expect(error.message).toBe('Session not found or already revoked');
    expect(error.requestId).toBe('3f1c1f0a-0f2c-4a3e-9b1e-2f5a6c7d8e90');
    expect(error.fields).toBeUndefined();
  });

  it('carries the fields of a validation error and drops malformed entries', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(
        respond(400, {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: {
              fields: {
                name: ['Name must be at least 2 characters'],
                email: 'not a list',
                age: [1, 2],
              },
            },
          },
        }),
      ),
    );

    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.fields).toEqual({ name: ['Name must be at least 2 characters'] });
  });

  it('keeps a field named __proto__ as an ordinary key', () => {
    const body: unknown = JSON.parse(
      '{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Validation failed",' +
        '"details":{"fields":{"__proto__":["polluted"]}}}}',
    );

    const { fields } = apiErrorFrom(() => unwrapEnvelope(respond(400, body)));

    expect(Object.keys(fields ?? {})).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(fields)).toBeNull();
  });

  it('reports no fields for details that belong to another error', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(
        respond(429, {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            details: { retryAfter: 60, fields: { name: ['ignored'] } },
          },
        }),
      ),
    );

    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.fields).toBeUndefined();
  });

  it('maps the status when an error envelope has no code', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(respond(403, { success: false, error: { message: 'Nope' } })),
    );

    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).toBe('Nope');
  });

  it.each([
    [400, 'INVALID_INPUT'],
    [401, 'SESSION_INVALID'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMIT_EXCEEDED'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
    [418, 'UNKNOWN_ERROR'],
  ])('maps status %i with no JSON body to %s', (status, code) => {
    const error = apiErrorFrom(() => unwrapEnvelope(respond(status)));

    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.message).toContain(String(status));
    expect(error.fields).toBeUndefined();
    expect(error.requestId).toBeUndefined();
  });

  it.each([
    ['an HTML page', '<html><body>Bad Gateway</body></html>'],
    ['an array', [{ success: true }]],
    ['an empty object', {}],
    ['a raw OAuth failure', { error: 'invalid_grant' }],
    ['an error object without the failure flag', { error: { code: 'FORBIDDEN', message: 'No' } }],
    ['null', null],
  ])('treats %s as a failure with the status code only', (_label, body) => {
    const error = apiErrorFrom(() => unwrapEnvelope(respond(502, body)));

    expect(error.status).toBe(502);
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('says the body is not an envelope when the status was a success', () => {
    const error = apiErrorFrom(() => unwrapEnvelope(respond(200, { id: 'u1' })));

    expect(error.status).toBe(200);
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.message).toMatch(/envelope/);
    expect(error.message).not.toMatch(/failed with status/);
  });

  it('says there is no JSON body when a success status carried none', () => {
    const error = apiErrorFrom(() => unwrapEnvelope(respond(204)));

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.message).toMatch(/no JSON body/);
  });

  it.each([200, 201, 299])('accepts a success envelope on status %i', (status) => {
    expect(unwrapEnvelope(respond(status, { success: true, data: 'ok' }))).toBe('ok');
  });

  it.each([199, 300])('refuses a success envelope on status %i', (status) => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(respond(status, { success: true, data: 'ok' })),
    );

    expect(error.status).toBe(status);
    expect(error.code).toBe('UNKNOWN_ERROR');
  });

  it('does not trust a success envelope on a failed status', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelope(respond(500, { success: true, data: { id: 'u1' } })),
    );

    expect(error.status).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
  });
});

describe('unwrapEnvelopeBody', () => {
  it('throws the same ApiError for an error envelope in the body', () => {
    const error = apiErrorFrom(() =>
      unwrapEnvelopeBody({
        success: false,
        error: { code: 'SESSION_INVALID', message: 'Invalid session' },
        requestId: 'req-7',
      }),
    );

    expect(error.code).toBe('SESSION_INVALID');
    expect(error.message).toBe('Invalid session');
    expect(error.requestId).toBe('req-7');
  });

  it('throws for a body that is not an envelope', () => {
    const error = apiErrorFrom(() => unwrapEnvelopeBody(undefined));

    expect(error.status).toBe(200);
    expect(error.code).toBe('UNKNOWN_ERROR');
  });
});
