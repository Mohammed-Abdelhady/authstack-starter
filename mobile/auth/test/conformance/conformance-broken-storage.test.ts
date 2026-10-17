import { describe } from 'vitest';
import type { CredentialsPort, CryptoPort, InstallPort } from '../../src';
import { type BrokenAdapter, itCatches } from '../support/conformance-broken';
import type { FakeSubject } from '../support/conformance-fakes';

/** A write the store refuses is checked once per reason. */
const WRITE_CHECKS = [
  'credentials.write-locked',
  'credentials.write-cancelled',
  'credentials.write-unavailable',
];

function credentials(
  fault: string,
  fails: string[],
  broken: (inner: CredentialsPort) => Partial<CredentialsPort>,
): BrokenAdapter {
  return {
    fault,
    fails,
    install(subject: FakeSubject) {
      const inner = subject.parts.credentials;
      subject.adapters.credentials = {
        read: () => inner.read(),
        replace: (value) => inner.replace(value),
        delete: () => inner.delete(),
        ...broken(inner),
      };
    },
  };
}

function crypto(
  fault: string,
  fails: string[],
  broken: (inner: CryptoPort) => Partial<CryptoPort>,
): BrokenAdapter {
  return {
    fault,
    fails,
    install(subject: FakeSubject) {
      const inner = subject.parts.crypto;
      subject.adapters.crypto = {
        randomBytes: (length) => inner.randomBytes(length),
        sha256: (bytes) => inner.sha256(bytes),
        ...broken(inner),
      };
    },
  };
}

function install(
  fault: string,
  fails: string[],
  identity: (inner: InstallPort) => InstallPort['identity'],
): BrokenAdapter {
  return {
    fault,
    fails,
    install(subject: FakeSubject) {
      subject.adapters.install = { identity: identity(subject.parts.install) };
    },
  };
}

function neverWritten(inner: CredentialsPort): Partial<CredentialsPort> {
  let written = false;
  return {
    read: async () => (written ? inner.read() : { kind: 'unavailable' }),
    replace: (value) => {
      written = true;
      return inner.replace(value);
    },
  };
}

const readAs = (from: string, to: Awaited<ReturnType<CredentialsPort['read']>>) => {
  return (inner: CredentialsPort): Partial<CredentialsPort> => ({
    read: async () => {
      const result = await inner.read();
      return result.kind === from ? to : result;
    },
  });
};

describe('credentials faults', () => {
  itCatches([
    credentials(
      'reports a store nobody wrote to as unavailable',
      ['credentials.missing'],
      (inner) => neverWritten(inner),
    ),
    credentials('loses characters outside ASCII', ['credentials.found'], (inner) => ({
      read: async () => {
        const result = await inner.read();
        if (result.kind !== 'found') return result;
        return { kind: 'found', value: result.value.replace(/[^ -~]/g, '?') };
      },
    })),
    credentials('appends to the stored record', ['credentials.replace-overwrites'], (inner) => ({
      replace: async (value) => {
        const current = await inner.read();
        return inner.replace(current.kind === 'found' ? current.value + value : value);
      },
    })),
    credentials(
      'clears the record before writing the new one',
      ['credentials.replace-atomic'],
      (inner) => ({
        replace: async (value) => {
          await inner.delete();
          return inner.replace(value);
        },
      }),
    ),
    credentials(
      'hides a failed write',
      ['credentials.replace-atomic', ...WRITE_CHECKS],
      (inner) => ({
        replace: async (value) => {
          await inner.replace(value);
          return { kind: 'done' };
        },
      }),
    ),
    credentials(
      'does not delete',
      ['credentials.delete', 'credentials.discarded', ...WRITE_CHECKS],
      () => ({ delete: async () => ({ kind: 'done' }) }),
    ),
    credentials('throws when deleting from an empty store', ['credentials.delete'], (inner) => ({
      delete: async () => {
        if ((await inner.read()).kind === 'missing') throw new Error('Item not found');
        return inner.delete();
      },
    })),
    credentials(
      'reads a locked store as no account',
      ['credentials.locked'],
      readAs('locked', { kind: 'missing' }),
    ),
    credentials(
      'reads a dismissed prompt as a locked store',
      ['credentials.cancelled'],
      readAs('cancelled', { kind: 'locked' }),
    ),
    credentials(
      'hands back a damaged record',
      ['credentials.corrupt', 'credentials.discarded'],
      readAs('corrupt', { kind: 'found', value: '' }),
    ),
    credentials('throws when the store is unavailable', ['credentials.unavailable'], (inner) => ({
      read: async () => {
        const result = await inner.read();
        if (result.kind === 'unavailable') throw new Error('Keychain error -25291');
        return result;
      },
    })),
  ]);
});

describe('crypto faults', () => {
  itCatches([
    crypto('hashes only the first 32 bytes', ['crypto.pkce-vector'], (inner) => ({
      sha256: (bytes) => inner.sha256(bytes.slice(0, 32)),
    })),
    crypto('hashes text and drops bytes that are not ASCII', ['crypto.sha256-bytes'], (inner) => ({
      sha256: (bytes) => inner.sha256(bytes.filter((byte) => byte < 0x80)),
    })),
    crypto('returns one byte too many', ['crypto.random-bytes'], (inner) => ({
      randomBytes: (length) => inner.randomBytes(length + 1),
    })),
    crypto('returns the same bytes every time', ['crypto.random-bytes'], () => ({
      randomBytes: async (length) => new Uint8Array(length).fill(7),
    })),
  ]);
});

describe('install faults', () => {
  itCatches([
    install('never finds an identity', ['install.found', 'install.locked'], () => async () => ({
      kind: 'unavailable',
    })),
    install('makes a new identity on every read', ['install.found'], (inner) => {
      let reads = 0;
      return async () => {
        const result = await inner.identity();
        return result.kind === 'found' ? { kind: 'found', id: `install-${(reads += 1)}` } : result;
      };
    }),
    install('returns an empty identity', ['install.found'], (inner) => async () => {
      const result = await inner.identity();
      return result.kind === 'found' ? { kind: 'found', id: '' } : result;
    }),
    install(
      'invents an identity when storage is unreadable',
      ['install.unavailable'],
      (inner) => async () => {
        const result = await inner.identity();
        return result.kind === 'unavailable' ? { kind: 'found', id: 'made-up' } : result;
      },
    ),
    install('throws when storage is unreadable', ['install.unavailable'], (inner) => async () => {
      const result = await inner.identity();
      if (result.kind === 'unavailable') throw new Error('No-backup directory is missing');
      return result;
    }),
  ]);
});
