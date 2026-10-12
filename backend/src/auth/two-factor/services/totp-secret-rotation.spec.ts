import { ConfigService } from '@nestjs/config';
import { createCipheriv } from 'node:crypto';
import { AppException } from '../../../common/exceptions/app.exception';
import { StoredTotpSecret } from '../stores/second-factor-account';
import { TotpSecretCryptoService } from './totp-secret-crypto.service';

const OLD_KEY = Buffer.alloc(32, 7);
const NEW_KEY = Buffer.alloc(32, 9);
const THIRD_KEY = Buffer.alloc(32, 11);
/** HKDF-SHA256 of each key under the label `totp-key-id`, eight bytes, worked out apart from the service. */
const OLD_KEY_ID = '36ca8559637376a7';
const NEW_KEY_ID = '799fe81065255311';
const SECRET = 'JBSWY3DPEHPK3PXP';
const NOT_CONFIGURED = { code: 'TWO_FACTOR_NOT_CONFIGURED', status: 503 };

function service(current: Buffer, previous?: Buffer): TotpSecretCryptoService {
  return new TotpSecretCryptoService(
    new ConfigService({
      twoFactor: {
        encryptionKey: current.toString('base64'),
        previousEncryptionKey: previous?.toString('base64'),
      },
    }),
  );
}

/** A secret as it was stored before values named their key. */
function storedBeforeKeyIds(key: Buffer): StoredTotpSecret {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(SECRET, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function refusalOf(run: () => unknown): { code: string; status: number } {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus() };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('rotating the key TOTP secrets are stored under', () => {
  it('names the key a new value was written under', () => {
    const stored = service(NEW_KEY).encrypt(SECRET);

    expect(stored.ciphertext.split(':').slice(0, 2)).toEqual(['k', NEW_KEY_ID]);
    expect(service(OLD_KEY).encrypt(SECRET).ciphertext.split(':')[1]).toBe(
      OLD_KEY_ID,
    );
  });

  it('reads a value written under the current key and asks for no rewrite', () => {
    const crypto = service(NEW_KEY, OLD_KEY);

    expect(crypto.open(crypto.encrypt(SECRET))).toEqual({
      plaintext: SECRET,
      underPreviousKey: false,
    });
  });

  it('reads a value that names no key with the current key', () => {
    expect(service(OLD_KEY).open(storedBeforeKeyIds(OLD_KEY))).toEqual({
      plaintext: SECRET,
      underPreviousKey: false,
    });
  });

  it('reads a value written under the previous key and asks for a rewrite', () => {
    const stored = service(OLD_KEY).encrypt(SECRET);

    expect(service(NEW_KEY, OLD_KEY).open(stored)).toEqual({
      plaintext: SECRET,
      underPreviousKey: true,
    });
  });

  it('reads a value that names no key with the previous key once the current one fails', () => {
    expect(service(NEW_KEY, OLD_KEY).open(storedBeforeKeyIds(OLD_KEY))).toEqual(
      { plaintext: SECRET, underPreviousKey: true },
    );
  });

  it('refuses a value written under the previous key when no previous key is set', () => {
    const stored = service(OLD_KEY).encrypt(SECRET);

    expect(refusalOf(() => service(NEW_KEY).open(stored))).toEqual(
      NOT_CONFIGURED,
    );
    expect(
      refusalOf(() => service(NEW_KEY).open(storedBeforeKeyIds(OLD_KEY))),
    ).toEqual(NOT_CONFIGURED);
  });

  it('refuses a value written under a key that is neither the current nor the previous one', () => {
    const stored = service(THIRD_KEY).encrypt(SECRET);

    expect(refusalOf(() => service(NEW_KEY, OLD_KEY).open(stored))).toEqual(
      NOT_CONFIGURED,
    );
    expect(
      refusalOf(() =>
        service(NEW_KEY, OLD_KEY).open(storedBeforeKeyIds(THIRD_KEY)),
      ),
    ).toEqual(NOT_CONFIGURED);
  });

  it('refuses a value whose key name was changed to the other key', () => {
    const stored = service(NEW_KEY).encrypt(SECRET);
    const renamed = {
      ...stored,
      ciphertext: stored.ciphertext.replace(NEW_KEY_ID, OLD_KEY_ID),
    };

    expect(refusalOf(() => service(NEW_KEY, OLD_KEY).open(renamed))).toEqual(
      NOT_CONFIGURED,
    );
  });

  it('refuses a previous key that is not 32 bytes when a value needs it', () => {
    const stored = service(OLD_KEY).encrypt(SECRET);

    expect(
      refusalOf(() => service(NEW_KEY, Buffer.alloc(16, 7)).open(stored)),
    ).toEqual(NOT_CONFIGURED);
  });

  it('writes under the current key, so a rewritten value needs the previous key no longer', () => {
    const rotating = service(NEW_KEY, OLD_KEY);
    const opened = rotating.open(service(OLD_KEY).encrypt(SECRET));

    const rewritten = rotating.encrypt(opened.plaintext);

    expect(service(NEW_KEY).open(rewritten)).toEqual({
      plaintext: SECRET,
      underPreviousKey: false,
    });
  });

  it('signs the sign-in challenge with the current key whatever the previous one is', () => {
    expect(
      service(NEW_KEY, OLD_KEY)
        .challengeKey()
        .equals(service(NEW_KEY).challengeKey()),
    ).toBe(true);
  });
});
