/** Parses JSON, naming the file in the error when it is not JSON. */
export function parseJson(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${file}: ${reason}`);
  }
}
