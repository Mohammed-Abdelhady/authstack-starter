import { createPaint } from '@app/native-ui/testing';
import { renderToStaticMarkup } from 'react-dom/server';

export { createFakeNative, ofKind, type FakeNative, type Painted } from '@app/native-ui/testing';

/** Runs the component in the given appearance and returns what each native view was handed. */
export const paint = createPaint(renderToStaticMarkup);
