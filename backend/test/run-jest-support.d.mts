import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';

export function processExists(
  pid: number,
  checkProcess: (pid: number) => void,
): boolean;

export function removeOrphanedDataDirectories(
  parentDirectory: string,
  prefix: string,
  isProcessAlive: (pid: number) => boolean,
): string[];

export function processStartIdentity(
  pid: number,
  runPs?: (
    file: string,
    args: readonly string[],
    options: ExecFileSyncOptionsWithStringEncoding,
  ) => string,
  readStat?: (path: string, encoding: 'utf8') => string,
): string | undefined;

export function processStartIdentityToken(
  identity: string | null | undefined,
): string;

export function countActiveRuns(
  runDirectory: string,
  isProcessAlive: (pid: number) => boolean,
  probeStartIdentity?: (pid: number) => string | null | undefined,
): number;
