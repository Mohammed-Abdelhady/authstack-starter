import { afterEach, beforeEach } from 'vitest';

/** The `dir` in force on an element: its own, or its nearest ancestor's. */
export function directionOf(element: Element): string | null {
  return element.closest('[dir]')?.getAttribute('dir') ?? null;
}

/** Renders every test of the file in a right-to-left page, portals included. */
export function registerRtlDocument(): void {
  beforeEach(() => {
    document.documentElement.setAttribute('dir', 'rtl');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
  });
}
