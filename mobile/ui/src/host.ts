/** What a shell needs before it renders: nothing here loads the renderer. */
export { LOCALE, type Direction, type Locale } from './i18n';
export {
  deviceLocale,
  hostProps,
  logicalInsets,
  type HostAuth,
  type HostProps,
} from './logic/host';
export { isolateLtr } from './logic/isolate';
export type { EdgeInsets, NativeAppProps, PhysicalInsets } from './types';
