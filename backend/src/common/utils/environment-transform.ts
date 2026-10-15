export function transformBoolean(
  defaultValue?: boolean,
): (params: { value: unknown }) => unknown {
  return ({ value }: { value: unknown }): unknown => {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (value === 'true' || value === true) {
      return true;
    }
    if (value === 'false' || value === false) {
      return false;
    }
    return value;
  };
}

/** Blank values left in copied example files behave as unset options. */
export function transformOptionalString({
  value,
}: {
  value: unknown;
}): unknown {
  return value === '' ? undefined : value;
}

export function parseOptionalInteger(value: unknown): number | undefined {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return undefined;
  }
  return typeof value === 'string' || typeof value === 'number'
    ? Number(value)
    : Number.NaN;
}
