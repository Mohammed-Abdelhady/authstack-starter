import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/packed/fixtures/workspace-cancellation.case.ts'],
    pool: 'forks',
    maxWorkers: 1,
    reporters: [
      'default',
      {
        onInit(vitest) {
          // The non-TTY CLI exits on SIGINT without cancelling its pool.
          for (const listener of process.listeners('SIGINT')) process.off('SIGINT', listener);
          const cancel = (): void => {
            process.exitCode = 130;
            void vitest.cancelCurrentRun('keyboard-input');
            // The pool enters cancellation before this acknowledgement is sent.
            process.send?.('cancelling');
          };
          process.on('SIGINT', cancel);
          vitest.onClose(() => {
            process.off('SIGINT', cancel);
          });
        },
      },
    ],
  },
});
