import {
  createApiClient,
  createBrowserTransport,
  type HttpMethod,
  type BrowserFetch,
} from '@app/sdk';
import { audienceRequest } from '../audience-authorization.fixtures';
import type { E2eApp, TestAgent } from '../e2e-app';
import type { Test } from 'supertest';
import type { IssuedBrowserSession } from '../../../src/session/services/session-issuance.service';

const VERBS: Record<HttpMethod, 'get' | 'post' | 'patch' | 'delete'> = {
  GET: 'get',
  POST: 'post',
  PATCH: 'patch',
  DELETE: 'delete',
};

type Verb = 'get' | 'post' | 'patch' | 'delete';

export function staffClient(
  e2e: E2eApp,
  options: { issued: IssuedBrowserSession; loseReplyAt?: string },
) {
  return clientFor({
    requestFor: (path, method) =>
      audienceRequest(e2e, options.issued, path, method),
    proof: options.issued.csrfToken,
    loseReplyAt: options.loseReplyAt,
  });
}

export function browserCookieClient(browser: TestAgent) {
  return clientFor({ requestFor: (path, method) => browser[method](path) });
}

function clientFor(options: {
  requestFor: (path: string, method: Verb) => Test;
  proof?: string;
  loseReplyAt?: string;
}) {
  let lost = false;
  const fetch: BrowserFetch = async (path, init) => {
    if (!(init.method in VERBS)) throw new Error('Unsupported fixture method');
    const method = Object.entries(VERBS).find(
      ([key]) => key === init.method,
    )?.[1];
    if (!method) throw new Error('Missing fixture method');
    let call = options.requestFor(path, method);
    for (const [name, value] of Object.entries(init.headers))
      call = call.set(name, value);
    if (init.body !== undefined) call = call.send(init.body);
    const response = await call;
    return {
      status: response.status,
      headers: {
        get: (name) =>
          typeof response.headers[name.toLowerCase()] === 'string'
            ? response.headers[name.toLowerCase()]
            : null,
      },
      text: () => {
        if (
          !lost &&
          options.loseReplyAt === path &&
          init.method === 'POST' &&
          response.status === 201
        ) {
          lost = true;
          return Promise.reject(
            new Error('The network lost the committed reply'),
          );
        }
        return Promise.resolve(response.text);
      },
    };
  };
  const transport = createBrowserTransport({ fetch });
  if (options.proof !== undefined)
    transport.rememberBrowserProof(options.proof, 'session');
  return createApiClient(transport);
}
