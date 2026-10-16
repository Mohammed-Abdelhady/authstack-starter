export class AdminCommandError extends Error {}

export function adminCommandFailure(command: string, error: unknown): void {
  console.log(
    JSON.stringify({
      command,
      status: 'refused',
      message:
        error instanceof AdminCommandError ? error.message : 'Command failed',
    }),
  );
  process.exitCode = 1;
}
