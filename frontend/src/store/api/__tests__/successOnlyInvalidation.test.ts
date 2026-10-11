// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { refusal, registerFormTestLifecycle, success } from '@/tests/serverRejectionHarness';
import { CONVERTED, SESSION_REVOCATIONS, SIGN_OUT } from './invalidationRefetchCases';
import { UNTAGGED } from './untaggedRefetchCases';
import { describeSuccessOnly, describeUntagged, requestsOf } from './mutationSweepBase';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

describeSuccessOnly(CONVERTED);
describeUntagged(UNTAGGED);

// The success-only and untagged suites live in the shared base; the
// session-revocation suite is only used here.
describe.each(SESSION_REVOCATIONS)('$name invalidates even when refused', (mutation) => {
  it('repeats its reads after a 400 refusal', async () => {
    const requests = await requestsOf(mutation, () => refusal(['name']));
    expect(requests.slice(mutation.requests.length).sort()).toEqual([...mutation.refetched].sort());
  });

  it('also repeats its reads after the server accepted it', async () => {
    const requests = await requestsOf(mutation, () => success(mutation.accepted));
    expect(requests.slice(mutation.requests.length).sort()).toEqual([...mutation.refetched].sort());
  });
});

describe('logout', () => {
  it('repeats nothing after the server confirmed the sign-out', async () => {
    expect(await requestsOf(SIGN_OUT, () => success(SIGN_OUT.accepted))).toEqual([
      'GET /api/user/profile',
      'POST /api/auth/logout',
    ]);
  });

  it('asks for the profile again after a refused sign-out', async () => {
    expect(await requestsOf(SIGN_OUT, () => refusal(['name']))).toEqual([
      'GET /api/user/profile',
      'POST /api/auth/logout',
      'GET /api/user/profile',
    ]);
  });

  it('asks for the profile again when the answer is lost', async () => {
    const requests = await requestsOf(SIGN_OUT, () => {
      throw new TypeError('Failed to fetch');
    });
    expect(requests).toEqual([
      'GET /api/user/profile',
      'POST /api/auth/logout',
      'GET /api/user/profile',
    ]);
  });
});
