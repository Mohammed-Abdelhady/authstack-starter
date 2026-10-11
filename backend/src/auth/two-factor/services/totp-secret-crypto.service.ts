import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';
import { StoredTotpSecret } from '../stores/second-factor-account';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  TWO_FACTOR_CHALLENGE_HKDF_INFO,
  TWO_FACTOR_KEY_ID_HKDF_INFO,
} from '../constants/two-factor.constants';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID_BYTES = 8;
/** A stored ciphertext that names its key reads `k:<key id>:<base64>`. */
const KEY_ID_MARK = 'k';
const KEY_ID_SEPARATOR = ':';

const CURRENT_KEY_SETTING = 'TOTP_ENCRYPTION_KEY';
const PREVIOUS_KEY_SETTING = 'TOTP_ENCRYPTION_KEY_PREVIOUS';

/** A secret that was read, and whether the key before this one read it. */
export interface OpenedTotpSecret {
  plaintext: string;
  /** True when the value should be written again under the current key. */
  underPreviousKey: boolean;
}

interface NamedCiphertext {
  /** Absent on a value stored before values named their key. */
  keyId?: string;
  ciphertext: string;
}

/**
 * Encrypts TOTP secrets at rest with AES-256-GCM under TOTP_ENCRYPTION_KEY,
 * and derives the separate key the login challenge is signed with. One secret
 * in the environment, two keys that cannot stand in for each other.
 *
 * Each stored value names the key it was written under, so the key can be
 * replaced: TOTP_ENCRYPTION_KEY_PREVIOUS holds the key before this one, and a
 * value it still reads is written again under the current key by its caller.
 * A value that names no key is read with the current key, then the previous.
 */
@Injectable()
export class TotpSecretCryptoService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(plaintext: string): StoredTotpSecret {
    const key = this.key();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: [
        KEY_ID_MARK,
        keyIdOf(key),
        ciphertext.toString('base64'),
      ].join(KEY_ID_SEPARATOR),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  /**
   * @throws AppException TWO_FACTOR_NOT_CONFIGURED when the key is missing, or
   * when neither the current nor the previous key reads the record
   */
  decrypt(secret: StoredTotpSecret): string {
    return this.open(secret).plaintext;
  }

  /**
   * Reads a secret and says whether the previous key was what read it.
   *
   * @throws AppException TWO_FACTOR_NOT_CONFIGURED when the key is missing, or
   * when neither the current nor the previous key reads the record
   */
  open(secret: StoredTotpSecret): OpenedTotpSecret {
    const current = this.key();
    const named = readKeyId(secret.ciphertext);
    const sealed = { ...secret, ciphertext: named.ciphertext };

    if (named.keyId === undefined || named.keyId === keyIdOf(current)) {
      const plaintext = unseal(sealed, current);
      if (plaintext !== null) {
        return { plaintext, underPreviousKey: false };
      }
    }

    const previous = this.previousKey();
    if (
      previous &&
      (named.keyId === undefined || named.keyId === keyIdOf(previous))
    ) {
      const plaintext = unseal(sealed, previous);
      if (plaintext !== null) {
        return { plaintext, underPreviousKey: true };
      }
    }

    throw this.notConfigured(
      'the stored secret does not decrypt with the configured key',
    );
  }

  /** Signing key for the login challenge, derived from the same environment key. */
  challengeKey(): Buffer {
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.key(),
        Buffer.alloc(0),
        TWO_FACTOR_CHALLENGE_HKDF_INFO,
        KEY_BYTES,
      ),
    );
  }

  private key(): Buffer {
    const configured = this.configService.get<string>(
      'twoFactor.encryptionKey',
    );

    if (!configured) {
      throw this.notConfigured(`${CURRENT_KEY_SETTING} is not set`);
    }

    return this.decodeKey(configured, CURRENT_KEY_SETTING);
  }

  /** The key before the current one, while a rotation is under way. */
  private previousKey(): Buffer | undefined {
    const configured = this.configService.get<string>(
      'twoFactor.previousEncryptionKey',
    );

    return configured
      ? this.decodeKey(configured, PREVIOUS_KEY_SETTING)
      : undefined;
  }

  private decodeKey(configured: string, setting: string): Buffer {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== KEY_BYTES) {
      throw this.notConfigured(
        `${setting} decodes to ${key.length} bytes, ${KEY_BYTES} expected`,
      );
    }

    return key;
  }

  private notConfigured(reason: string): AppException {
    return new AppException(
      ErrorCode.TWO_FACTOR_NOT_CONFIGURED,
      `Two-factor authentication is not configured: ${reason}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** A short name for a key, derived so it says nothing about the key itself. */
function keyIdOf(key: Buffer): string {
  return Buffer.from(
    hkdfSync(
      'sha256',
      key,
      Buffer.alloc(0),
      TWO_FACTOR_KEY_ID_HKDF_INFO,
      KEY_ID_BYTES,
    ),
  ).toString('hex');
}

/** Base64 holds no separator, so a value with one names its key. */
function readKeyId(stored: string): NamedCiphertext {
  const [mark, keyId, ciphertext, ...rest] = stored.split(KEY_ID_SEPARATOR);
  if (
    mark !== KEY_ID_MARK ||
    keyId === undefined ||
    ciphertext === undefined ||
    rest.length > 0
  ) {
    return { ciphertext: stored };
  }
  return { keyId, ciphertext };
}

/** The plaintext, or null when this key did not write the record. */
function unseal(secret: StoredTotpSecret, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(secret.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
