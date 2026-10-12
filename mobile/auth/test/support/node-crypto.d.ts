declare module 'node:crypto' {
  interface KeyObject {
    readonly type: string;
  }

  interface JsonWebKey {
    kty: string;
    crv: string;
    x: string;
    y: string;
    d?: string;
    key_ops?: string[];
    ext?: boolean;
  }

  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(): Uint8Array;
  }

  export function createHash(algorithm: 'sha256'): Hash;
  export function createPrivateKey(options: { key: JsonWebKey; format: 'jwk' }): KeyObject;
  export function createPublicKey(options: { key: JsonWebKey; format: 'jwk' }): KeyObject;
  export function sign(
    algorithm: 'sha256',
    data: Uint8Array,
    options: { key: KeyObject; dsaEncoding: 'ieee-p1363' },
  ): Uint8Array;
  export function verify(
    algorithm: 'sha256',
    data: Uint8Array,
    options: { key: KeyObject; dsaEncoding: 'ieee-p1363' },
    signature: Uint8Array,
  ): boolean;
}

declare module 'node:buffer' {
  export class Buffer extends Uint8Array {
    static from(value: string): Buffer;
    static from(value: Uint8Array): Buffer;
    static from(value: string, encoding: 'base64url' | 'utf8'): Buffer;
    toString(encoding?: 'utf8'): string;
  }
}
