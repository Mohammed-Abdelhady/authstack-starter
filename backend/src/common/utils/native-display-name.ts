import { NAME_MAX_LENGTH } from '../constants/name';

export function nativeDisplayName(value: unknown, email: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return Array.from((name || email.trim()).normalize('NFC'))
    .slice(0, NAME_MAX_LENGTH)
    .join('');
}
