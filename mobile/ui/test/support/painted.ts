import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';

export type Style = Record<string, unknown>;
type StyleInput = Style | readonly StyleInput[] | null | undefined | false;
type PressableStyle = (state: { pressed: boolean }) => StyleInput;

export interface Painted {
  kind: string;
  style: Style;
  props: Record<string, unknown>;
  /** What the view holds when that is plain text. */
  text?: string;
}

interface HostProps {
  style?: StyleInput | PressableStyle;
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

/** A value that never moves: one pass has no frame after the first. */
class StillValue {
  setValue(): void {}
  interpolate(): StillValue {
    return this;
  }
}

/** Stands in for the native views, which only a device can draw, and keeps what each was handed. */
export function createFakeNative() {
  const painted: Painted[] = [];
  const state: { scheme: string | null } = { scheme: null };
  const host = (kind: string) =>
    function Host({ style, children, ...props }: HostProps) {
      const resting = typeof style === 'function' ? style({ pressed: false }) : style;
      const text = typeof children === 'string' ? { text: children } : {};
      painted.push({ kind, style: flatten(resting), props, ...text });
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
      Pressable: host('Pressable'),
      Animated: { View: host('View'), Value: StillValue },
    },
  };
}

export type FakeNative = ReturnType<typeof createFakeNative>;

/** A renderer the package under test already carries. The screens package has none of its own. */
export type RenderOnce = (element: ReactElement) => string;

/** Runs the component in the given appearance and returns what each native view was handed. */
export function createPaint(render: RenderOnce) {
  return (native: FakeNative, scheme: string | null, element: ReactElement): Painted[] => {
    native.painted.length = 0;
    native.state.scheme = scheme;
    render(element);
    return [...native.painted];
  };
}

export const ofKind = (painted: readonly Painted[], kind: string): Painted[] =>
  painted.filter((entry) => entry.kind === kind);
