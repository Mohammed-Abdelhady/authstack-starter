/** The shell's own dependency, used here only to run a component's hooks without a device. */
declare module 'react-dom/server' {
  import type { ReactElement } from 'react';
  export function renderToStaticMarkup(element: ReactElement): string;
}
