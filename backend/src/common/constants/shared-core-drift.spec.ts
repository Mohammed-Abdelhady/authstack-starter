import { ErrorCode as BackendErrorCode } from '../enums/error-code.enum';
import {
  ALL_PERMISSIONS as BackendAllPermissions,
  RESERVED_PERMISSIONS as BackendReservedPermissions,
} from './permissions';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from './password';
import { ErrorCode as SharedErrorCode } from '../../../../shared/core/src/error-codes';
import {
  ALL_PERMISSIONS as SharedAllPermissions,
  RESERVED_PERMISSIONS as SharedReservedPermissions,
} from '../../../../shared/core/src/permissions';
import {
  MIN_PASSWORD_LENGTH as SharedMinPasswordLength,
  MAX_PASSWORD_BYTES as SharedMaxPasswordBytes,
} from '../../../../shared/core/src/password-rules';
import {
  HOST_PERMISSIONS as SharedHostPermissions,
  ROLE_AUDIENCE as SharedRoleAudience,
} from '../../../../shared/core/src/host-access';
import { HOST_PERMISSIONS as BackendHostPermissions } from '../../host/access';
import { ROLE_AUDIENCE as BackendRoleAudience } from '../../host/types/host-role.type';

// Backend-only error codes the web client maps by status code or a generic message instead.
const BACKEND_ONLY_ERROR_CODES = [
  'ACCOUNT_CREATION_REFUSED', // no-op policy; shared code and messages follow refusal rules.
  'ROLE_NOT_FOUND', // role seeding lookup; the web client surfaces generic NOT_FOUND.
];

// Codes a client assigns itself and the server never sends.
const SHARED_ONLY_ERROR_CODES = [
  'UNKNOWN_ERROR', // a response with no code and a status with no mapping.
];

function sortedStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map(String))].sort();
}

describe('shared core drift', () => {
  it('keeps the same permission strings on both sides', () => {
    const backend = sortedStrings(BackendAllPermissions);
    const shared = sortedStrings(SharedAllPermissions);

    expect(shared).toEqual(backend);
  });

  it('keeps reserved permissions equal and out of the active catalogue', () => {
    expect(SharedReservedPermissions).toEqual(BackendReservedPermissions);
    for (const permission of SharedReservedPermissions) {
      expect(SharedAllPermissions).not.toContain(permission);
      expect(BackendAllPermissions).not.toContain(permission);
    }
  });

  // Exact and in order: the seed and the picker follow list order, and a
  // repeated entry is a mistake in one copy.
  it('keeps the same host permission strings on both sides, in order', () => {
    expect(SharedHostPermissions).toEqual(BackendHostPermissions);
  });

  it('keeps the same role audiences on both sides', () => {
    expect(SharedRoleAudience).toEqual(BackendRoleAudience);
  });

  it('keeps the same error-code values except the named one-sided ones', () => {
    const backend = sortedStrings(Object.values(BackendErrorCode));
    const shared = sortedStrings(Object.values(SharedErrorCode));

    const backendOnly = backend.filter((code) => !shared.includes(code));
    const sharedOnly = shared.filter((code) => !backend.includes(code));

    expect(backendOnly).toEqual([...BACKEND_ONLY_ERROR_CODES].sort());
    expect(sharedOnly).toEqual([...SHARED_ONLY_ERROR_CODES].sort());
  });

  it('keeps the same minimum password length on both sides', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(SharedMinPasswordLength);
  });

  it('keeps the same maximum password bytes on both sides', () => {
    expect(PASSWORD_MAX_BYTES).toBe(SharedMaxPasswordBytes);
  });
});
