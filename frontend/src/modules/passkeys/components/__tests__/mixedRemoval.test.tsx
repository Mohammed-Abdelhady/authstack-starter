// @vitest-environment jsdom
import { ErrorCode } from '@app/core';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  descriptions,
  registerFormTestLifecycle,
  renderForm,
} from '@/tests/serverRejectionHarness';
import { PasskeyList } from '../PasskeyList';

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('mixed relying-party removal advice in %s', (locale) => {
  it('offers only the removable row and explains the required key refusal', async () => {
    const onDelete = vi.fn();
    const passkey = {
      name: 'Key',
      backedUp: false,
      createdAt: '2026-10-17T00:00:00Z',
      lastUsedAt: null,
    };
    const { format, message } = await renderForm(
      locale,
      <PasskeyList
        passkeys={[
          {
            ...passkey,
            id: 'web',
            name: 'Required web key',
            canRemove: false,
            removalBlockedCode: ErrorCode.PASSKEY_REQUIRED_LAST,
          },
          { ...passkey, id: 'native', name: 'Optional native key', canRemove: true },
        ]}
        isLoading={false}
        canRemove={true}
        onDelete={onDelete}
        onRename={vi.fn()}
      />,
    );
    const blocked = screen.getByRole('button', {
      name: format('settings.passkeys.delete.label', { name: 'Required web key' }),
    });
    const allowed = screen.getByRole('button', {
      name: format('settings.passkeys.delete.label', { name: 'Optional native key' }),
    });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    expect(descriptions(blocked)).toEqual([
      message('settings.passkeys.delete.blockedRequiredPasskey'),
    ]);
    fireEvent.click(blocked);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(allowed);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'native' }));
  });
});
