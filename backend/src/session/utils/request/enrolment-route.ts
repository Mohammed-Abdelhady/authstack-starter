import type { Request } from 'express';
import { BROWSER_APPLICATION_ROUTES } from '../../constants/browser-application-routes';

export function enrolmentRouteAllowed(
  request: Pick<Request, 'method' | 'path'>,
): boolean {
  return (
    (request.method === 'GET' &&
      BROWSER_APPLICATION_ROUTES.ENROLMENT_READ.test(request.path)) ||
    (request.method === 'POST' &&
      BROWSER_APPLICATION_ROUTES.ENROLMENT_WRITE.test(request.path))
  );
}
