import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../src/i18n/messages';
import { DebugScreen } from '../src/screen/DebugScreen';
import { startShell } from './support/shell';
import { ofKind, paint } from './support/painted';

const native = await vi.hoisted(async () => (await import('./support/painted')).createFakeNative());

vi.mock('react-native', () => native.module);
/** A single pass has no later change to hear, so the store is read once where it stands. */
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: <T>(_subscribe: unknown, read: () => T): T => read(),
}));

/** Written by hand: the address the fake server holds, inside a left-to-right isolate. */
const ISOLATED_ADDRESS = '⁦person@example.test⁩';

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the account line of the sign-in check screen in %s', (locale) => {
  const shells: ReturnType<typeof startShell>[] = [];
  const lines = (shell: ReturnType<typeof startShell>) =>
    ofKind(
      paint(
        native,
        'light',
        createElement(DebugScreen, { auth: shell.auth, locale, onClose: () => undefined }),
      ),
      'Text',
    ).map((line) => line.text);

  afterEach(() => {
    for (const shell of shells.splice(0)) shell.auth.engine.dispose();
  });

  it('keeps the address left to right inside the sentence', async () => {
    const shell = startShell();
    shells.push(shell);

    await shell.auth.engine.restore();

    expect((await shell.auth.engine.signIn()).kind).toBe('signedIn');
    expect(lines(shell)).toContain(translate(locale, 'account', ISOLATED_ADDRESS));
  });
});
