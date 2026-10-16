export const DELETION_RECHECK_WAIT_MS = 10_000;
export const DELETION_VIEW = {
  CHECKING: 'checking',
  READY: 'ready',
  DELETING: 'deleting',
  DELETED: 'deleted',
  UNRESOLVED: 'unresolved',
  STORAGE_ERROR: 'storageError',
} as const;
export const DELETION_REFUSAL = {
  ADMIN: 'ADMIN_CANNOT_DEACTIVATE_SELF',
  VALIDATION: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
} as const;
export const DELETION_TEST_ID = {
  SECTION: 'deletion-section',
  DELETE: 'deletion-delete',
  CHECK: 'deletion-check',
  NOTICE: 'deletion-notice',
  BUSY: 'deletion-busy',
} as const;
