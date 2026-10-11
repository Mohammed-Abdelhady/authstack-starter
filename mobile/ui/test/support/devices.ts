import type { Session } from '@app/sdk';
import { session } from './fake-server';

/** Stored names, so each device's text is the literal a test writes by hand. */
export const PHONE: Session = session('phone', {
  isCurrent: true,
  credentialPurpose: 'native_access',
  deviceName: 'Pocket phone',
});
export const LAPTOP: Session = session('laptop', { deviceName: 'Work laptop' });
export const TABLET: Session = session('tablet', { deviceName: 'Hall tablet' });
