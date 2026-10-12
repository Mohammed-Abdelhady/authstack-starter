import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import type {
  EncryptedNativeCodeReply,
  NativeAttempt,
} from '../types/native-attempt';

function key(secret: string): Buffer {
  return createHash('sha256')
    .update('native-code-reply:v1:')
    .update(secret)
    .digest();
}

function context(attempt: NativeAttempt): Buffer {
  return Buffer.from(
    `${attempt.attemptId}\0${attempt.clientId}\0${attempt.redirectUri}`,
    'utf8',
  );
}

export function encryptCodeReply(
  attempt: NativeAttempt,
  secret: string,
  redirectUri: string,
  expiresAt: Date,
): EncryptedNativeCodeReply {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(context(attempt));
  const ciphertext = Buffer.concat([
    cipher.update(redirectUri, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    expiresAt,
  };
}

export function decryptCodeReply(
  attempt: NativeAttempt,
  secret: string,
): string {
  const reply = attempt.details.codeReply;
  if (!reply) throw new Error('Native authorization reply absent');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(secret),
    Buffer.from(reply.iv, 'base64url'),
  );
  decipher.setAAD(context(attempt));
  decipher.setAuthTag(Buffer.from(reply.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(reply.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
