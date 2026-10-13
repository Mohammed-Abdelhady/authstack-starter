export function fontReadiness(loaded: boolean, error: Error | null): boolean {
  return loaded && !error;
}
