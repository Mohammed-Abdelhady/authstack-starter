// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { API_PATHS } from '@app/sdk';
import { TWO_FACTOR_PATHS } from '../../constants';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TwoFactorCard } from '../TwoFactorCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const PROFILE_OFF = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  twoFactorEnabled: false,
  linkedProviders: ['email'],
};
const PROFILE_ON = { ...PROFILE_OFF, twoFactorEnabled: true };
const METHODS = {
  methods: { password: true, magicLink: false, twoFactor: true, passkeys: false, oauth: [] },
};
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUrl:
    'otpauth://totp/App:user@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=App',
};
const RECOVERY_CODES = [
  'K3M7QRTVWX',
  'B8N2PLHZDF',
  'M4N8QPVXCD',
  'W7J2KT9RHF',
  'A6C3D8VYPL',
  'Q5T2X9BMNR',
  'H8F4L2ZKPW',
  'R3Y7C5NQDM',
  'P9V6A4JXTK',
  'D2M8W5HCRL',
];

registerFormTestLifecycle();

it('keeps all setup codes through the profile refresh and focuses the section after Done', async () => {
  let profileReads = 0;
  const writeBodies: Array<[string, unknown]> = [];
  let releaseProfile: (response: Response) => void = () => undefined;
  const heldProfile = new Promise<Response>((resolve) => {
    releaseProfile = resolve;
  });
  const requests = stubNetwork(async (request, path) => {
    if (path === API_PATHS.auth.methods) return success(METHODS);
    if (path === API_PATHS.user.profile) {
      profileReads += 1;
      return profileReads === 1 ? success(PROFILE_OFF) : heldProfile;
    }
    if (path === TWO_FACTOR_PATHS.SETUP || path === TWO_FACTOR_PATHS.CONFIRM) {
      writeBodies.push([`${request.method} ${path}`, await request.json()]);
      return path === TWO_FACTOR_PATHS.SETUP
        ? success(SETUP)
        : success({ recoveryCodes: RECOVERY_CODES });
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  const form = await renderForm('en', <TwoFactorCard />);

  fireEvent.click(await screen.findByTestId('two-factor-setup-open'));
  fireEvent.change(await screen.findByTestId('two-factor-reauth-password'), {
    target: { value: 'Passw0rdLayla' },
  });
  fireEvent.submit(screen.getByTestId('two-factor-reauth-form'));
  fireEvent.click(await screen.findByTestId('two-factor-scan-continue'));
  fireEvent.change(await screen.findByTestId('two-factor-confirm-code'), {
    target: { value: '123456' },
  });
  fireEvent.submit(screen.getByTestId('two-factor-confirm-form'));

  const codeList = await screen.findByTestId('two-factor-recovery-codes');
  await waitFor(() => expect(profileReads).toBe(2));
  expect(within(codeList).getAllByRole('listitem')).toHaveLength(10);
  expect(codeList.textContent).toContain(RECOVERY_CODES[9]);
  expect(screen.getByTestId('two-factor-status-badge').textContent).toBe(
    form.message('settings.twoFactor.statusOff'),
  );
  expect(writeBodies).toEqual([
    [`POST ${TWO_FACTOR_PATHS.SETUP}`, { password: 'Passw0rdLayla' }],
    [`POST ${TWO_FACTOR_PATHS.CONFIRM}`, { code: '123456' }],
  ]);

  const done = screen.getByTestId('two-factor-setup-done');
  expect(done.hasAttribute('disabled')).toBe(true);
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
  fireEvent.pointerDown(document.body);
  expect(screen.getByTestId('two-factor-recovery-codes')).toBeTruthy();
  expect(done.hasAttribute('disabled')).toBe(true);

  releaseProfile(success(PROFILE_ON));
  await waitFor(() =>
    expect(screen.getByTestId('two-factor-status-badge').textContent).toBe(
      form.message('settings.twoFactor.statusOn'),
    ),
  );
  expect(screen.getByTestId('two-factor-recovery-codes')).toBeTruthy();

  fireEvent.click(screen.getByTestId('two-factor-saved-codes'));
  await waitFor(() => expect(done.hasAttribute('disabled')).toBe(false));
  fireEvent.click(done);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: form.message('settings.twoFactor.title') }),
    ),
  );
  expect(requests).toEqual([
    `GET ${API_PATHS.user.profile}`,
    `GET ${API_PATHS.auth.methods}`,
    `POST ${TWO_FACTOR_PATHS.SETUP}`,
    `POST ${TWO_FACTOR_PATHS.CONFIRM}`,
    `GET ${API_PATHS.user.profile}`,
  ]);
});
