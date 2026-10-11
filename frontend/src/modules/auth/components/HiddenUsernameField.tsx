'use client';

import { useAppSelector } from '@/store/hooks';
import { selectUser } from '../store/authSlice';

/**
 * Tells a password manager whose password a form is about, where the form
 * asks for a password without showing the address. It sits outside the form's
 * values, so it is never sent, and it is out of the layout, the tab order and
 * the accessibility tree.
 */
export function HiddenUsernameField() {
  const email = useAppSelector(selectUser)?.email;

  if (!email) {
    return null;
  }

  return (
    <input
      type="text"
      name="username"
      autoComplete="username"
      value={email}
      readOnly
      hidden
      data-testid="account-username"
    />
  );
}
