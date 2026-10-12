const LEFT_TO_RIGHT_ISOLATE = '⁦';
const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

/** For a value that always reads left to right: an address, a code, a system or product name. */
export function isolateLtr(value: string): string {
  return `${LEFT_TO_RIGHT_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

/** For words a person typed, which read in the direction of their own first letter. */
export function isolateTyped(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}
