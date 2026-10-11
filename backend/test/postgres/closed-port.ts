import { createServer } from 'node:net';

/** A local port nothing listens on: one the system just gave out and took back. */
export function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('the system gave no port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}
