import { ConfigService } from '@nestjs/config';
import { TotpSecretCryptoService } from '../services/totp-secret-crypto.service';
import {
  codeAt,
  outcomeOf,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

const OLD_KEY = Buffer.alloc(32, 21).toString('base64');
const NEW_KEY = Buffer.alloc(32, 22).toString('base64');
const OTHER_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** A service that holds one key and nothing before it. */
function holding(key: string): TotpSecretCryptoService {
  return new TotpSecretCryptoService(
    new ConfigService({ twoFactor: { encryptionKey: key } }),
  );
}

/** Reading and rewriting stored secrets while the encryption key is replaced. */
export function keyRotationCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('writes a secret again under the current key when its account answers a code, so the previous key is needed no longer', async () => {
    const { ownerId } = fixture();
    await seedEnabled(harness(), holding(OLD_KEY), ownerId);
    const before = await harness().secondFactor(ownerId);
    const rotating = twoFactorServices(harness(), [], {
      current: NEW_KEY,
      previous: OLD_KEY,
    });
    const account = await harness().accounts.findAccount(ownerId);
    if (!account) throw new Error('the account is missing');

    await rotating.verification.verifyTotpCode(
      account,
      codeAt(harness().clock, TOTP_SECRET),
    );

    const after = await harness().secondFactor(ownerId);
    if (!after.secret || !before.secret) {
      throw new Error('the secret is missing');
    }
    expect(after.secret.ciphertext).not.toBe(before.secret.ciphertext);
    // Only the new key is held here: the old one reads nothing any more.
    expect(holding(NEW_KEY).open(after.secret)).toEqual({
      plaintext: TOTP_SECRET,
      underPreviousKey: false,
    });
    expect({ ...after, secret: null }).toEqual({
      ...before,
      secret: null,
      lastUsedStep: STEP_AT_TEST_NOW,
    });
  });

  it('writes the secret again even when the code it was read for is wrong', async () => {
    const { ownerId } = fixture();
    await seedEnabled(harness(), holding(OLD_KEY), ownerId);
    const rotating = twoFactorServices(harness(), [], {
      current: NEW_KEY,
      previous: OLD_KEY,
    });
    const account = await harness().accounts.findAccount(ownerId);
    if (!account) throw new Error('the account is missing');

    const outcome = await outcomeOf(
      rotating.verification.verifyTotpCode(
        account,
        wrongCode(harness().clock, TOTP_SECRET),
      ),
    );

    const { secret } = await harness().secondFactor(ownerId);
    if (!secret) throw new Error('the secret is missing');
    expect(outcome).toBe('TWO_FACTOR_CODE_INVALID');
    expect(holding(NEW_KEY).open(secret).plaintext).toBe(TOTP_SECRET);
  });

  it('leaves a secret stored under the current key as it is', async () => {
    const { ownerId } = fixture();
    await seedEnabled(harness(), holding(NEW_KEY), ownerId);
    const before = await harness().secondFactor(ownerId);
    const rotating = twoFactorServices(harness(), [], {
      current: NEW_KEY,
      previous: OLD_KEY,
    });
    const account = await harness().accounts.findAccount(ownerId);
    if (!account) throw new Error('the account is missing');

    await rotating.verification.verifyTotpCode(
      account,
      codeAt(harness().clock, TOTP_SECRET),
    );

    expect((await harness().secondFactor(ownerId)).secret).toEqual(
      before.secret,
    );
  });

  it('keeps a secret that changed after the account was read, and replaces only its own account', async () => {
    const { ownerId, otherId } = fixture();
    const crypto = holding(NEW_KEY);
    await seedEnabled(harness(), crypto, ownerId);
    await seedEnabled(harness(), crypto, otherId);
    const readEarlier = await harness().accounts.findAccount(ownerId);
    if (!readEarlier) throw new Error('the account is missing');
    // A new setup lands between the read and the rewrite.
    const newer = crypto.encrypt(OTHER_SECRET);
    await seedEnabled(harness(), crypto, ownerId, { secret: newer });
    const otherBefore = (await harness().secondFactor(otherId)).secret;

    await harness().accounts.replaceSecret(
      readEarlier,
      crypto.encrypt(TOTP_SECRET),
    );

    expect((await harness().secondFactor(ownerId)).secret).toEqual(newer);
    expect((await harness().secondFactor(otherId)).secret).toEqual(otherBefore);
  });

  it('replaces the stored secret of the account it was read from', async () => {
    const { ownerId } = fixture();
    const crypto = holding(NEW_KEY);
    await seedEnabled(harness(), crypto, ownerId);
    const account = await harness().accounts.findAccount(ownerId);
    if (!account) throw new Error('the account is missing');
    const replacement = crypto.encrypt(OTHER_SECRET);

    await harness().accounts.replaceSecret(account, replacement);

    expect((await harness().secondFactor(ownerId)).secret).toEqual(replacement);
  });
}
