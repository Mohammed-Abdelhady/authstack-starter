import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export type Style = Record<string, unknown>;
type StyleInput = Style | readonly StyleInput[] | null | undefined | false;

export interface Painted {
  kind: string;
  style: Style;
  props: Record<string, unknown>;
}

interface HostProps {
  style?: StyleInput;
  children?: ReactNode;
  [name: string]: unknown;
}

/** Later entries win, as they do on a device. */
function flatten(style: StyleInput): Style {
  if (!style) return {};
  if (isList(style)) return Object.assign({}, ...style.map(flatten));
  return style;
}

function isList(style: Style | readonly StyleInput[]): style is readonly StyleInput[] {
  return Array.isArray(style);
}

/** Stands in for the native views, which only a device can draw, and keeps what each was handed. */
export function createFakeNative() {
  const painted: Painted[] = [];
  const state: { scheme: string | null } = { scheme: null };
  const host = (kind: string) =>
    function Host({ style, children, ...props }: HostProps) {
      painted.push({ kind, style: flatten(style), props });
      return createElement(Fragment, null, children);
    };
  return {
    painted,
    state,
    module: {
      useColorScheme: () => state.scheme,
      StyleSheet: { create: <T>(styles: T): T => styles },
      View: host('View'),
      Text: host('Text'),
      ScrollView: host('ScrollView'),
      StatusBar: host('StatusBar'),
      Button: host('Button'),
    },
  };
}

export type FakeNative = ReturnType<typeof createFakeNative>;

/** Runs the component in the given appearance and returns what each native view was handed. */
export function paint(native: FakeNative, scheme: string | null, element: ReactElement): Painted[] {
  native.painted.length = 0;
  native.state.scheme = scheme;
  renderToStaticMarkup(element);
  return [...native.painted];
}

export const ofKind = (painted: readonly Painted[], kind: string): Painted[] =>
  painted.filter((entry) => entry.kind === kind);
