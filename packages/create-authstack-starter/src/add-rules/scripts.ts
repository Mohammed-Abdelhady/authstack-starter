import { isRecord } from '../manifest/read.js';

export function hasProjectScript(manifest: Record<string, unknown>, name: string): boolean {
  const value: unknown = isRecord(manifest.scripts) ? manifest.scripts[name] : undefined;
  return typeof value === 'string' && value.trim().length > 0;
}
