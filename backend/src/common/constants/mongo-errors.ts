export const MONGO_DUPLICATE_KEY_CODE = 11000;
// feature:mongodb:start
export const MONGO_TRANSIENT_TRANSACTION_LABEL = 'TransientTransactionError';

export const MONGO_UNAVAILABLE_CODES: ReadonlySet<number> = new Set([
  6, // HostUnreachable
  7, // HostNotFound
  24, // LockTimeout
  50, // MaxTimeMSExpired
  64, // WriteConcernFailed
  89, // NetworkTimeout
  91, // ShutdownInProgress
  112, // WriteConflict after transaction attempts are exhausted
  133, // FailedToSatisfyReadPreference
  251, // NoSuchTransaction
  262, // ExceededTimeLimit
  9001, // SocketException
  11600, // InterruptedAtShutdown
  11601, // Interrupted
  11602, // InterruptedDueToReplStateChange
  10107, // NotWritablePrimary
  13435, // NotPrimaryNoSecondaryOk
  13436, // NotPrimaryOrSecondary
  189, // PrimarySteppedDown
]);
// feature:mongodb:end
