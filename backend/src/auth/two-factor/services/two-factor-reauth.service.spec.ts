import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/exceptions/app.exception';
import { HashService } from '../../../common/services/hash.service';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { TwoFactorReauthService } from './two-factor-reauth.service';

/** Never compared: no case here sends a password. */
const STORED_HASH = 'a-stored-password-hash';
const NOW = new Date('2099-01-01T12:00:00.000Z');

/** The service on the real switches, read from the deployment's settings. */
function reauthWith(passwordEnabled: boolean): TwoFactorReauthService {
  const config = new ConfigService({
    auth: { passwordEnabled },
    bcrypt: { rounds: 4 },
  });
  return new TwoFactorReauthService(
    new HashService(config),
    new AuthFeaturesService(config),
  );
}

async function refusalCodeOf(attempt: Promise<void>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
  return 'accepted';
}

describe('TwoFactorReauthService on the deployment switches', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  afterEach(() => jest.restoreAllMocks());

  it('takes a recent sign-in from an account that stores a password when the setting turns password sign-in off', async () => {
    const reauth = reauthWith(false);

    expect(
      await refusalCodeOf(
        reauth.assertReauthenticated({ passwordHash: STORED_HASH }, undefined, {
          createdAt: NOW,
        }),
      ),
    ).toBe('accepted');
    expect(
      await refusalCodeOf(
        reauth.assertPasswordIfSet({ passwordHash: STORED_HASH }, undefined),
      ),
    ).toBe('accepted');
  });

  // feature:email-password:start
  it('asks for the stored password when the setting leaves password sign-in on', async () => {
    const reauth = reauthWith(true);

    expect(
      await refusalCodeOf(
        reauth.assertReauthenticated({ passwordHash: STORED_HASH }, undefined, {
          createdAt: NOW,
        }),
      ),
    ).toBe('REAUTH_REQUIRED');
    expect(
      await refusalCodeOf(
        reauth.assertPasswordIfSet({ passwordHash: STORED_HASH }, undefined),
      ),
    ).toBe('REAUTH_REQUIRED');
  });
  // feature:email-password:end
});
