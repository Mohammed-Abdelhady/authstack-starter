import type { AuthBrowserResult } from '@app/native-auth';
import { unwrapIdentityBody } from '@app/sdk';
import type { TestAgent } from '../e2e-app';

export interface BrowserConsentAttempt {
  choice: 'approve' | 'deny';
  transactionId: string;
  expectedUserId: string;
}

export async function authorizeWithBrowser(
  browser: TestAgent,
  address: string,
  choice: 'approve' | 'deny',
  attempts: BrowserConsentAttempt[],
): Promise<AuthBrowserResult> {
  const identityResponse = await browser.get('/api/auth/identity').expect(200);
  const identity = unwrapIdentityBody(identityResponse.body);
  if (!identity.authenticated) {
    return { kind: 'failed', reason: 'Sign in before approving this request' };
  }

  const authorize = new URL(address);
  const response = await browser
    .get(`${authorize.pathname}${authorize.search}`)
    .redirects(0);
  const location = response.headers.location;
  if (response.status !== 302 || typeof location !== 'string') {
    return {
      kind: 'failed',
      reason: 'Authorization did not open the approval page',
    };
  }
  const transactionId = new URL(location, 'http://localhost').searchParams.get(
    'transaction',
  );
  if (!transactionId) {
    return { kind: 'failed', reason: 'Authorization transaction was missing' };
  }

  attempts.push({
    choice,
    transactionId,
    expectedUserId: identity.user.id,
  });
  const approval = await browser
    .post(`/api/oauth/authorize/${choice}`)
    .send({ transactionId, expectedUserId: identity.user.id })
    .expect(200);
  return { kind: 'redirect', url: approvalRedirect(approval.body) };
}

function approvalRedirect(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    throw new Error('Approval response had no data');
  }
  const data = value.data;
  if (typeof data !== 'object' || data === null || !('redirectUri' in data)) {
    throw new Error('Approval response had no return address');
  }
  if (typeof data.redirectUri !== 'string') {
    throw new Error('Return address was not a string');
  }
  return data.redirectUri;
}
