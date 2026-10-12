const unhandledRequests: string[] = [];

function requestName(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const url = input instanceof Request ? input.url : String(input);
  return `${method.toUpperCase()} ${new URL(url, 'http://localhost').pathname}`;
}

const rejectUnhandled: typeof fetch = async (input, init) => {
  const request = requestName(input, init);
  unhandledRequests.push(request);
  throw new Error(`Unhandled network request: ${request}`);
};

/** Keep the fallback in place even when a test restores its explicit fetch stub. */
export function installNetworkGuard(): void {
  globalThis.fetch = rejectUnhandled;
}

/** Reports every request that escaped an explicit answer, including caught failures. */
export function takeUnhandledRequests(): string[] {
  return unhandledRequests.splice(0);
}
