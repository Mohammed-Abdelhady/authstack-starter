import { UNSAFE_PATH_SEGMENTS } from '../constants';

/**
 * One value as one path segment. `encodeURIComponent` leaves `.` and `..`
 * alone and a URL parser resolves them, so they are refused along with the
 * empty string instead of being sent to another route.
 */
export function pathSegment(value: string, name: string): string {
  if (UNSAFE_PATH_SEGMENTS.has(value)) {
    throw new TypeError(`${name} cannot be used in a path: ${JSON.stringify(value)}`);
  }
  return encodeURIComponent(value);
}
