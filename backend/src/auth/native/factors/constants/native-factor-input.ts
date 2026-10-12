import { PASSWORD_MAX_BYTES } from '../../../../common/constants/password';
import {
  TOTP_DIGITS,
  RECOVERY_CODE_LENGTH,
} from '../../../two-factor/constants/two-factor.constants';

export const NATIVE_FACTOR_INPUT_LIMIT = {
  EMAIL: 255,
  PASSWORD_BYTES: PASSWORD_MAX_BYTES,
  PASSKEY_FIELD: 16_384,
} as const;

export const NATIVE_FACTOR_INPUT_PATTERN = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
  CODE: new RegExp(`^\\d{${TOTP_DIGITS}}$`, 'u'),
  RECOVERY_CODE: new RegExp(
    `^[A-Za-z2-7\\s-]{${RECOVERY_CODE_LENGTH},24}$`,
    'u',
  ),
} as const;
