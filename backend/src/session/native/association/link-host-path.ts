import { LINK_HOST_RESERVED_PATH_PREFIXES } from './constants/link-host';

/** Backend and proxy compare one decoded path; separators cannot be encoded. */
export function canonicalLinkHostPath(path: string): string | undefined {
  if (!path.startsWith('/') || /%(?:2f|5c)/iu.test(path)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (/[\s\\?#%]/u.test(decoded) || /\p{Cc}/u.test(decoded)) return undefined;
  if (
    decoded.includes('//') ||
    decoded.split('/').some((part) => part === '.' || part === '..')
  ) {
    return undefined;
  }
  const lowered = decoded.toLowerCase();
  if (
    LINK_HOST_RESERVED_PATH_PREFIXES.some(
      (prefix) => lowered === prefix || lowered.startsWith(`${prefix}/`),
    )
  ) {
    return undefined;
  }
  return decoded;
}
