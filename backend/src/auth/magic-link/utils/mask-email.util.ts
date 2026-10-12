const HIDDEN = '***';

/**
 * An address with its local part cut to the first character, for a screen
 * that asks its owner to recognise it without showing it to anyone else.
 *
 * @param email - Address the link belongs to
 * @returns For example `a***@example.com`
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) {
    return HIDDEN;
  }
  return `${email[0]}${HIDDEN}${email.slice(at)}`;
}
