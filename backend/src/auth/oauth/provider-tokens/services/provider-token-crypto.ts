import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';
import {
  PROVIDER_TOKEN_KEY_ID_INFO,
  PROVIDER_TOKEN_KEY_INFO,
} from '../constants/provider-tokens.constants';
import type { SealedToken, TokenOwner } from '../types/provider-tokens';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID_BYTES = 8;
const CIPHER = 'aes-256-gcm';

interface TokenKey {
  id: string;
  key: Buffer;
}

function derive(secret: string, info: string, length: number): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.alloc(0),
      info,
      length,
    ),
  );
}

function tokenKey(secret: string): TokenKey {
  return {
    id: derive(secret, PROVIDER_TOKEN_KEY_ID_INFO, KEY_ID_BYTES).toString(
      'hex',
    ),
    key: derive(secret, PROVIDER_TOKEN_KEY_INFO, KEY_BYTES),
  };
}

/** The owner is bound into the ciphertext, so a token cannot be read as another's. */
function ownerOf(owner: TokenOwner): Buffer {
  return Buffer.from(
    JSON.stringify([owner.provider, owner.subject, owner.clientId]),
    'utf8',
  );
}

function unseal(
  sealed: SealedToken,
  key: Buffer,
  owner: TokenOwner,
): string | null {
  try {
    const decipher = createDecipheriv(
      CIPHER,
      key,
      Buffer.from(sealed.iv, 'base64'),
    );
    decipher.setAAD(ownerOf(owner));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Encrypts provider tokens at rest under PROVIDER_TOKEN_ENCRYPTION_KEY. Each
 * stored value names its key, so the key can be rotated the way the TOTP key
 * is: the old key moves to PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS, and a
 * token written under it is still read and revoked.
 */
@Injectable()
export class ProviderTokenCrypto {
  constructor(private readonly config: ConfigService) {}

  /** False while no key is set: tokens are then not kept at all. */
  canSeal(): boolean {
    return this.current() !== undefined;
  }

  /** @throws Error when no key is set; ask `canSeal` first */
  seal(token: string, owner: TokenOwner): SealedToken {
    const current = this.current();
    if (!current) throw new Error('PROVIDER_TOKEN_ENCRYPTION_KEY is not set');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER, current.key, iv);
    cipher.setAAD(ownerOf(owner));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyId: current.id,
    };
  }

  /** The token, or null when neither configured key wrote it. */
  open(sealed: SealedToken, owner: TokenOwner): string | null {
    for (const candidate of [this.current(), this.previous()]) {
      if (candidate?.id === sealed.keyId) {
        return unseal(sealed, candidate.key, owner);
      }
    }
    return null;
  }

  private current(): TokenKey | undefined {
    const secret = this.config.get<string>('providerTokens.encryptionKey');
    return secret ? tokenKey(secret) : undefined;
  }

  private previous(): TokenKey | undefined {
    const secret = this.config.get<string>(
      'providerTokens.previousEncryptionKey',
    );
    return secret ? tokenKey(secret) : undefined;
  }
}
