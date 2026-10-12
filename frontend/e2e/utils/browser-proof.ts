import { expect, type APIRequestContext } from '@playwright/test';

const CSRF_HEADER = 'x-csrf-token';

async function proofAt(request: APIRequestContext, url: string): Promise<string> {
  const answer = await request.get(url);
  expect(answer.status()).toBe(200);
  const body: unknown = await answer.json();
  expect(body).toMatchObject({ success: true, data: { token: expect.any(String) } });
  const token = (body as { data: { token: string } }).data.token;
  expect(answer.headers()[CSRF_HEADER]).toBe(token);
  return token;
}

export function publicBrowserProof(request: APIRequestContext, api: string): Promise<string> {
  return proofAt(request, `${api}/auth/browser-proof`);
}

export function sessionBrowserProof(request: APIRequestContext, api: string): Promise<string> {
  return proofAt(request, `${api}/auth/csrf`);
}

export { CSRF_HEADER };
