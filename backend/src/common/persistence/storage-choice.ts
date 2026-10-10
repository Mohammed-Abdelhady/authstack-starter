/** The databases this build carries an adapter for. The ids match the installer's manifest. */
export const STORAGE_KIND = {
  MONGODB: 'mongodb', // feature:mongodb
  POSTGRES: 'postgres', // feature:postgres
} as const;

export type StorageKind = (typeof STORAGE_KIND)[keyof typeof STORAGE_KIND];

export const STORAGE_KINDS: readonly StorageKind[] =
  Object.values(STORAGE_KIND);

/** The database when nothing names another: the first one this build carries. */
export const DEFAULT_STORAGE_KIND: StorageKind = STORAGE_KINDS[0];

// feature:database-choice:start
/** The environment setting that names the database. */
export const STORAGE_KIND_VARIABLE = 'DATABASE_TYPE';

/** The first kind an adapter was picked for, kept to catch a later change. */
let picked: StorageKind | undefined;

function isStorageKind(value: unknown): value is StorageKind {
  return STORAGE_KINDS.some((kind) => kind === value);
}

/** Unset or blank is the default. Anything else must be a known database. */
export function storageKindOf(value: unknown): StorageKind {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_STORAGE_KIND;
  }
  if (!isStorageKind(value)) {
    const given = typeof value === 'string' ? `"${value}"` : typeof value;
    throw new Error(
      `${STORAGE_KIND_VARIABLE} must be one of ${STORAGE_KINDS.join(', ')}, got ${given}`,
    );
  }
  return value;
}
// feature:database-choice:end

/** The database this process runs on. */
export function chosenStorage(): StorageKind {
  // feature:database-choice:start
  const named = process.env[STORAGE_KIND_VARIABLE];
  if (named !== undefined && named !== '') {
    return storageKindOf(named);
  }
  // feature:database-choice:end
  return DEFAULT_STORAGE_KIND;
}

function missingAdapter(kind: StorageKind): Error {
  // feature:database-choice:start
  if (process.env[STORAGE_KIND_VARIABLE]) {
    return new Error(
      `${STORAGE_KIND_VARIABLE} is "${kind}", and this build does not carry that adapter`,
    );
  }
  // feature:database-choice:end
  return new Error(`This build carries no adapter for "${kind}"`);
}

/**
 * Hands a module the adapter wiring of the database the process runs on, when
 * the module file is loaded. Module metadata is fixed at load, so this is the
 * one place that knows the database, and no service, guard or controller ever
 * asks. Wiring that is not handed over is never built or connected.
 */
export function forStorage<Wiring>(
  adapters: Partial<Record<StorageKind, () => Wiring>>,
): Wiring {
  const kind = chosenStorage();
  const adapter = adapters[kind];
  if (!adapter) {
    throw missingAdapter(kind);
  }
  picked ??= kind; // feature:database-choice
  return adapter();
}

// feature:database-choice:start
/**
 * Called with the validated setting. Refuses when a module already picked its
 * adapter under another value, which happens only if a module file was loaded
 * before the environment file was read.
 */
export function confirmStorageChoice(validated: unknown): void {
  const kind = storageKindOf(validated);
  if (picked !== undefined && picked !== kind) {
    throw new Error(
      `${STORAGE_KIND_VARIABLE} is "${kind}", but modules were already wired for "${picked}". Load the configuration before any module file.`,
    );
  }
}

/** For specs that load module files under more than one setting. */
export function forgetStorageChoice(): void {
  picked = undefined;
}
// feature:database-choice:end
