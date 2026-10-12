import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import {
  CONTENT_SECURITY_POLICY_HEADER,
  NONCE_HEADER,
  buildContentSecurityPolicy,
  createNonce,
} from './lib/config/security-headers';

const handleLocale = createMiddleware(routing);

// Pathnames the locale routing owns: everything except `/api`, `/_next`,
// `/_vercel` and paths containing a dot (e.g. `favicon.ico`).
const LOCALIZED_PATHNAME = /^\/((?!api|_next|_vercel|.*\..*).*)$/;

/**
 * Sends the content security policy with a nonce made for this request, on the
 * response and on the request the page renders from, then lets the locale
 * routing answer.
 */
export default function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    isDevelopment: process.env.NODE_ENV === 'development',
  });

  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set(CONTENT_SECURITY_POLICY_HEADER, policy);

  const response = LOCALIZED_PATHNAME.test(request.nextUrl.pathname)
    ? handleLocale(new NextRequest(request, { headers }))
    : NextResponse.next({ request: { headers } });
  response.headers.set(CONTENT_SECURITY_POLICY_HEADER, policy);

  return response;
}

export const config = {
  // Every path that can answer with a document. Static files and API routes
  // need no policy.
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
