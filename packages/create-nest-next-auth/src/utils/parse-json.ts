/**
 * Parses JSON, naming the file in the error when it is not JSON. `problem`
 * words the error for a caller whose readers know the file by another phrase.
 */
export function parseJson(
  raw: string,
  file: string,
  problem: (file: string, reason: string) => string = (name, reason) =>
    `Could not parse ${name}: ${reason}`,
): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(problem(file, error instanceof Error ? error.message : String(error)));
  }
}
