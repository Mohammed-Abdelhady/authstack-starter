import { Component, createElement, type ReactElement, type ReactNode } from 'react';

/**
 * Stands in for `react-native`, which only a device can load. Each view is a
 * named host element that keeps the props it was handed, so a test reads what a
 * screen reader would be told and calls the handler a touch would reach.
 */
type Listener = (...values: never[]) => unknown;

interface Subscription {
  remove(): void;
}

function createEmitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    add(event: string, listener: Listener): Subscription {
      const set = listeners.get(event) ?? new Set<Listener>();
      listeners.set(event, set);
      set.add(listener);
      return { remove: () => void set.delete(listener) };
    },
    of: (event: string): Listener[] => [...(listeners.get(event) ?? [])],
    clear: () => listeners.clear(),
  };
}

export interface AlertButton {
  text: string;
  style?: string;
  onPress?: () => void;
}

export interface AlertCall {
  title: string;
  message: string;
  buttons: AlertButton[];
  options: { cancelable?: boolean; onDismiss?: () => void };
}

type PlatformName = 'android' | 'ios';

const appState = createEmitter();
const backHandler = createEmitter();
const accessibility = createEmitter();

/** What a test sets up and reads back. `reset` returns it to a fresh device. */
export const device = {
  scheme: null as string | null,
  platform: 'android' as PlatformName,
  reduceMotion: false,
  alerts: [] as AlertCall[],
  accessibilityAnnouncements: [] as string[],
  accessibilityFocusTags: [] as number[],
  nativeNodes: [] as unknown[],
  /** The app moved to this state, as the system reports it. */
  appStateChanged(state: string): void {
    for (const listener of appState.of('change')) (listener as (state: string) => void)(state);
  },
  /** The system back button. Answers whether any screen handled it. */
  pressBack(): boolean {
    return backHandler.of('hardwareBackPress').some((listener) => (listener as () => boolean)());
  },
  reduceMotionChanged(enabled: boolean): void {
    for (const listener of accessibility.of('reduceMotionChanged'))
      (listener as (enabled: boolean) => void)(enabled);
  },
  listenerCount: (): number =>
    appState.of('change').length +
    backHandler.of('hardwareBackPress').length +
    accessibility.of('reduceMotionChanged').length,
  reset(): void {
    device.scheme = null;
    device.platform = 'android';
    device.reduceMotion = false;
    device.alerts.length = 0;
    device.accessibilityAnnouncements.length = 0;
    device.accessibilityFocusTags.length = 0;
    device.nativeNodes.length = 0;
    appState.clear();
    backHandler.clear();
    accessibility.clear();
  },
};

export const HOST = {
  VIEW: 'View',
  TEXT_INPUT: 'TextInput',
  KEYBOARD_AVOIDING_VIEW: 'KeyboardAvoidingView',
  TEXT: 'Text',
  SCROLL_VIEW: 'ScrollView',
  STATUS_BAR: 'StatusBar',
  PRESSABLE: 'Pressable',
  FLAT_LIST: 'FlatList',
  REFRESH_CONTROL: 'RefreshControl',
  ANIMATED_VIEW: 'Animated.View',
} as const;

export const View = HOST.VIEW;
export const TextInput = HOST.TEXT_INPUT;
export const KeyboardAvoidingView = HOST.KEYBOARD_AVOIDING_VIEW;
interface TextProps {
  children?: ReactNode;
  [name: string]: unknown;
}

class NativeText extends Component<TextProps> {
  render(): ReactElement {
    const { children, ...props } = this.props;
    return createElement(HOST.TEXT, props, children);
  }
}

export const Text = NativeText;
export const ScrollView = HOST.SCROLL_VIEW;
export const StatusBar = HOST.STATUS_BAR;
export const RefreshControl = HOST.REFRESH_CONTROL;
export const Platform = {
  get OS() {
    return device.platform;
  },
};

interface PressableProps {
  style?: unknown;
  children?: ReactNode;
  [name: string]: unknown;
}

export function Pressable({ style, children, ...props }: PressableProps): ReactElement {
  const resolved = typeof style === 'function' ? (style({ pressed: false }) as unknown) : style;
  return createElement(HOST.PRESSABLE, { ...props, style: resolved }, children);
}

interface FlatListProps<Item> {
  data: readonly Item[];
  keyExtractor: (item: Item) => string;
  renderItem: (info: { item: Item }) => ReactElement;
  ListHeaderComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  refreshControl?: ReactNode;
  testID?: string;
}

export function FlatList<Item>({
  data,
  keyExtractor,
  renderItem,
  ListHeaderComponent,
  ListFooterComponent,
  refreshControl,
  testID,
}: FlatListProps<Item>): ReactElement {
  return createElement(
    HOST.FLAT_LIST,
    { testID },
    refreshControl,
    ListHeaderComponent,
    data.map((item) => createElement(HOST.VIEW, { key: keyExtractor(item) }, renderItem({ item }))),
    ListFooterComponent,
  );
}

export const StyleSheet = { create: <Styles>(styles: Styles): Styles => styles };

class AnimatedValue {
  constructor(public value: number) {}
  setValue(value: number): void {
    this.value = value;
  }
  interpolate(): AnimatedValue {
    return this;
  }
}

const motion = () => ({ start: (): void => undefined, stop: (): void => undefined });

export const Animated = {
  Value: AnimatedValue,
  View: HOST.ANIMATED_VIEW,
  timing: motion,
  loop: motion,
  sequence: motion,
};

export const useColorScheme = (): string | null => device.scheme;

const WINDOW_DIMENSIONS = { width: 390, height: 844, scale: 3, fontScale: 1 };
export const useWindowDimensions = () => WINDOW_DIMENSIONS;

export const AppState = {
  addEventListener: (event: string, listener: Listener): Subscription =>
    appState.add(event, listener),
};

export const BackHandler = {
  addEventListener: (event: string, listener: Listener): Subscription =>
    backHandler.add(event, listener),
};

export const AccessibilityInfo = {
  isReduceMotionEnabled: (): Promise<boolean> => Promise.resolve(device.reduceMotion),
  announceForAccessibility(announcement: string): void {
    device.accessibilityAnnouncements.push(announcement);
  },
  setAccessibilityFocus(tag: number): void {
    device.accessibilityFocusTags.push(tag);
  },
  addEventListener: (event: string, listener: Listener): Subscription =>
    accessibility.add(event, listener),
};

export function findNodeHandle(node: unknown): number | null {
  if (node === null || node === undefined) return null;
  device.nativeNodes.push(node);
  return device.nativeNodes.length;
}

export const Alert = {
  alert(
    title: string,
    message: string,
    buttons: AlertButton[],
    options: AlertCall['options'],
  ): void {
    device.alerts.push({ title, message, buttons, options });
  },
};
