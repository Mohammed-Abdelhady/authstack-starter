import type { PasskeyActions } from '@app/native-auth';
import type { PasskeySummary } from '@app/sdk';
import { createElement } from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasskeysSection } from '../../src/components/PasskeysSection';
import { PASSKEYS_TEST_ID } from '../../src/constants/passkeys';
import { translate } from '../../src/i18n';
import { signedInAs } from '../support/fake-engine';
import { createUiHarness } from '../support/hook';
import { LOCALES } from '../support/locales';
import { byRole, byTestId, cleanup, flush, isShown, press, render } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

function passkey(id: string, name: string): PasskeySummary {
  return { id, name, backedUp: true, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null };
}

/** An account holding a passkey an older rename left blank, beside a named one. */
const STORED = [passkey('blank', ''), passkey('phone', 'Phone')];

const actions: PasskeyActions = {
  available: () => Promise.resolve(true),
  register: () => Promise.resolve({ kind: 'cancelled' }),
  list: () => Promise.resolve({ passkeys: STORED }),
  rename: () => Promise.reject(new Error('Not renamed in this case.')),
  remove: () => Promise.reject(new Error('Not removed in this case.')),
};

const buttonNames = (row: ReactTestInstance): unknown[] =>
  byRole(row, 'button').map((node) => node.props.accessibilityLabel);

describe.each(LOCALES)('the passkeys section in %s', (locale) => {
  it('lists a passkey stored with a blank name under the fallback name, and still offers to add one', async () => {
    const harness = createUiHarness(signedInAs('ada'), locale);
    const root = render(harness.wrap(createElement(PasskeysSection, { passkeys: actions })));
    await flush();
    const unnamed = translate(locale, 'passkeys.unnamed');

    expect(isShown(root, `${PASSKEYS_TEST_ID.ROW}-phone`)).toBe(true);
    expect(isShown(root, PASSKEYS_TEST_ID.ADD)).toBe(true);
    expect(buttonNames(byTestId(root, `${PASSKEYS_TEST_ID.ROW}-blank`))).toEqual([
      translate(locale, 'passkeys.renameLabel', { name: unnamed }),
      translate(locale, 'passkeys.removeLabel', { name: unnamed }),
    ]);

    await press(byTestId(root, `${PASSKEYS_TEST_ID.ROW}-blank`), PASSKEYS_TEST_ID.REMOVE);
    expect(harness.confirm.asked.map((request) => request.title)).toEqual([
      translate(locale, 'passkeys.confirmRemove.title', { name: unnamed }),
    ]);
    await harness.confirm.answer(false);
  });
});
