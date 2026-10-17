/** Path segments that carry a secret, each kept out of the request log. */
const SECRET_SEGMENTS = [
  /^(\/api\/oauth\/authorize\/transaction)\/[^/]+(?=\/|$)/,
  /^(\/api\/auth\/account-deletion)\/[^/]+(?=\/|$)/,
];

export function getLoggableRequestPath(originalUrl: string): string {
  const path = originalUrl.split('?')[0];
  return SECRET_SEGMENTS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '$1/[redacted]'),
    path,
  );
}
