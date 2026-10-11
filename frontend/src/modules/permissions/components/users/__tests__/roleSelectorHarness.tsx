import { useState } from 'react';
import { expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { renderForm, stubNetwork, success } from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { UserRoleSelector } from '../UserRoleSelector';

export const CONFIRM_DIALOG = 'role-change-confirm-dialog';

function role(slug: string, name: string) {
  return {
    id: `role-${slug}`,
    slug,
    name,
    level: 1,
    permissions: [],
    isSystemRole: false,
    isProtected: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

const ROLES = {
  roles: [ADMIN_LISTED, role('user', 'User'), role('editor', 'Editor')],
  total: 3,
  page: 1,
};

interface SelectorOnCardProps {
  readonly onRoleChange: (role: string) => Promise<void>;
  /** Receives the type of every key event that reaches the page around the selector. */
  readonly heard: string[];
}

/** The selector as a card holds it: the role shown is the last one saved. */
function SelectorOnCard({ onRoleChange, heard }: SelectorOnCardProps) {
  const [saved, setSaved] = useState('user');
  const hear = (event: { type: string }) => heard.push(event.type);
  return (
    <div onKeyDown={hear} onKeyPress={hear} onKeyUp={hear}>
      <UserRoleSelector
        userId="user-2"
        currentRole={saved}
        onRoleChange={async (next) => {
          await onRoleChange(next);
          setSaved(next);
        }}
      />
    </div>
  );
}

/** Renders the selector for a user whose role is "User", with its list loaded. */
export async function renderSelector(locale: AppLocale) {
  const requests = stubNetwork(() => success(ROLES));
  const onRoleChange = vi.fn<(role: string) => Promise<void>>(async () => undefined);
  const heard: string[] = [];
  const form = await renderForm(
    locale,
    <SelectorOnCard onRoleChange={onRoleChange} heard={heard} />,
    storeSignedInAs('admin'),
  );
  const trigger = screen.getByRole('combobox');
  await waitFor(() => {
    expect(trigger.hasAttribute('disabled')).toBe(false);
  });
  return { ...form, requests, onRoleChange, trigger, heard };
}

/** Opens the role list by keyboard and puts focus on the "Editor" option. */
export async function focusEditorOption(locale: AppLocale) {
  const view = await renderSelector(locale);
  view.trigger.focus();
  fireEvent.keyDown(view.trigger, { key: 'Enter' });
  (await screen.findByRole('option', { name: 'Editor' })).focus();
  view.heard.length = 0;
  return view;
}

/** Waits until a dialog has opened and taken focus, then says what is on the page. */
export async function settledConfirmation(testId: string) {
  const dialog = await screen.findByTestId(testId);
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  return {
    open: screen.queryByTestId(testId) !== null,
    listOpen: screen.queryByRole('listbox') !== null,
  };
}

/** The test id of the element that holds focus once the dialog has gone. */
export async function focusAfterClose(testId: string): Promise<string | null> {
  await waitFor(() => {
    expect(screen.queryByTestId(testId)).toBeNull();
  });
  await waitFor(() => {
    expect(document.activeElement).not.toBe(document.body);
  });
  return document.activeElement?.getAttribute('data-testid') ?? null;
}

/** Gives jsdom the two DOM methods the list of a select needs. */
export function stubListLayout() {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
}
