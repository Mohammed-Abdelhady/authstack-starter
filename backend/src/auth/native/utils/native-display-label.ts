import { NATIVE_DISPLAY_LABEL_MAX_LENGTH } from '../constants/native-label';

export function nativeDisplayLabel(value: unknown, fallbackId: string): string {
  const label =
    (typeof value === 'string' ? value.trim().normalize('NFC') : '') ||
    fallbackId.trim().normalize('NFC');
  let bounded = '';
  for (const point of label) {
    if (bounded.length + point.length > NATIVE_DISPLAY_LABEL_MAX_LENGTH) break;
    bounded += point;
  }
  return bounded.trim();
}
