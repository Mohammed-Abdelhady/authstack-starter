export const PROCESS_TREE_STOP_TIMEOUT_MS: number;
export function isRunning(pid: number | string): boolean;
export function stopProcessTree(leader: number, timeout?: number): void;
