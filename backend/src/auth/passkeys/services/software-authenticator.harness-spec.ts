import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import type { PasskeyCredentialJson } from './webauthn.adapter';

/**
 * A software authenticator for the specs that cross the real WebAuthn library:
 * a P-256 key pair, the authenticator data and client data a browser would
 * hand over, and a signature over them. Nothing here calls the library.
 */

/** Authenticator data flag bits, WebAuthn level 2, section 6.1. */
export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_ATTESTED_CREDENTIAL = 0x40;

const P256_COORDINATE_BYTES = 32;
const AAGUID = Buffer.alloc(16);

export interface SoftwareAuthenticator {
  credentialId: string;
  /** The public key as the server stores it: a COSE EC2 key in CBOR. */
  cosePublicKey: Buffer;
  privateKey: KeyObject;
}

export interface CeremonyInput {
  rpId: string;
  origin: string;
  challenge: string;
  flags: number;
  counter: number;
}

function coordinate(value: string | undefined): Buffer {
  const bytes = Buffer.from(value ?? '', 'base64url');
  if (bytes.length !== P256_COORDINATE_BYTES) {
    throw new Error('expected a 32 byte P-256 coordinate');
  }
  return bytes;
}

/** CBOR for `{1: 2, 3: -7, -1: 1, -2: x, -3: y}`: EC2, ES256, P-256. */
function coseEc2Key(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    coordinate(jwk.x),
    Buffer.from([0x22, 0x58, 0x20]),
    coordinate(jwk.y),
  ]);
}

export function createSoftwareAuthenticator(
  credentialIdBytes: Buffer,
): SoftwareAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    credentialId: credentialIdBytes.toString('base64url'),
    cosePublicKey: coseEc2Key(publicKey),
    privateKey,
  };
}

function authenticatorData(input: CeremonyInput, attested?: Buffer): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(input.counter);
  return Buffer.concat([
    createHash('sha256').update(input.rpId).digest(),
    Buffer.from([input.flags]),
    counter,
    attested ?? Buffer.alloc(0),
  ]);
}

function clientData(type: string, input: CeremonyInput): Buffer {
  return Buffer.from(
    JSON.stringify({
      type,
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false,
    }),
  );
}

export interface SignedAssertion {
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
  signature: Buffer;
}

/** What the authenticator signs: its data, then the hash of the client data. */
export function signAssertion(
  authenticator: SoftwareAuthenticator,
  input: CeremonyInput,
): SignedAssertion {
  const data = authenticatorData(input);
  const client = clientData('webauthn.get', input);
  const signature = sign(
    'sha256',
    Buffer.concat([data, createHash('sha256').update(client).digest()]),
    authenticator.privateKey,
  );
  return { authenticatorData: data, clientDataJSON: client, signature };
}

export function toAssertionCredential(
  authenticator: SoftwareAuthenticator,
  signed: SignedAssertion,
): PasskeyCredentialJson {
  return {
    id: authenticator.credentialId,
    rawId: authenticator.credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      authenticatorData: signed.authenticatorData.toString('base64url'),
      clientDataJSON: signed.clientDataJSON.toString('base64url'),
      signature: signed.signature.toString('base64url'),
    },
  };
}

export function assertionCredential(
  authenticator: SoftwareAuthenticator,
  input: CeremonyInput,
): PasskeyCredentialJson {
  return toAssertionCredential(
    authenticator,
    signAssertion(authenticator, input),
  );
}

/** CBOR byte string header for a length under 65536. */
function cborBytesHeader(length: number): Buffer {
  if (length < 24) {
    return Buffer.from([0x40 + length]);
  }
  if (length < 256) {
    return Buffer.from([0x58, length]);
  }
  return Buffer.from([0x59, length >> 8, length & 0xff]);
}

/** CBOR for `{fmt: "none", attStmt: {}, authData: <bytes>}`. */
function attestationObject(authData: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa3]),
    Buffer.from([0x63]),
    Buffer.from('fmt'),
    Buffer.from([0x64]),
    Buffer.from('none'),
    Buffer.from([0x67]),
    Buffer.from('attStmt'),
    Buffer.from([0xa0]),
    Buffer.from([0x68]),
    Buffer.from('authData'),
    cborBytesHeader(authData.length),
    authData,
  ]);
}

/** A registration answer with attestation "none", as a platform key sends it. */
export function attestationCredential(
  authenticator: SoftwareAuthenticator,
  input: CeremonyInput,
): PasskeyCredentialJson {
  const credentialId = Buffer.from(authenticator.credentialId, 'base64url');
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credentialId.length);
  const attested = Buffer.concat([
    AAGUID,
    idLength,
    credentialId,
    authenticator.cosePublicKey,
  ]);
  const data = authenticatorData(
    { ...input, flags: input.flags | FLAG_ATTESTED_CREDENTIAL },
    attested,
  );
  return {
    id: authenticator.credentialId,
    rawId: authenticator.credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      attestationObject: attestationObject(data).toString('base64url'),
      clientDataJSON: clientData('webauthn.create', input).toString(
        'base64url',
      ),
      transports: ['internal'],
    },
  };
}
