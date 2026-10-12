/** The part of React's test renderer the rendered tests use. The package ships no types. */
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, unknown>;
    parent: ReactTestInstance | null;
    children: (ReactTestInstance | string)[];
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    update(element: ReactElement): void;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
}
