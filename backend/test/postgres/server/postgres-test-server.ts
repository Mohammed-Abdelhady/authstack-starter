import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Jest hook budget for creating a cluster and starting its server under load. */
export const POSTGRES_BOOT_TIMEOUT_MS = 120000;

/** Jest hook budget for stopping the server and removing its data. */
export const POSTGRES_TEARDOWN_TIMEOUT_MS = 60000;

/** Jest hook budget for emptying every table and seeding a case's first rows under load. */
export const POSTGRES_RESET_TIMEOUT_MS = 10000;

const LAUNCHER = join(__dirname, 'postgres-server.mjs');
const HOST = '127.0.0.1';
const USER = 'postgres';
const DATABASE = 'postgres';

export interface PostgresTestServer {
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  dataDirectory: string;
  stop: () => Promise<void>;
}

interface ServerAnnouncement {
  port: number;
  password: string;
  dataDirectory: string;
}

function readAnnouncement(line: string): ServerAnnouncement {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The PostgreSQL test server announced nothing usable');
  }
  const port: unknown = Reflect.get(parsed, 'port');
  const password: unknown = Reflect.get(parsed, 'password');
  const dataDirectory: unknown = Reflect.get(parsed, 'dataDirectory');
  if (
    typeof port !== 'number' ||
    typeof password !== 'string' ||
    typeof dataDirectory !== 'string'
  ) {
    throw new Error('The PostgreSQL test server announced nothing usable');
  }
  return { port, password, dataDirectory };
}

/**
 * Starts a server of its own for the calling suite. The launcher names the data
 * folder after this process, removes folders that dead processes left, and
 * stops the server when this process closes the pipe or dies.
 */
export async function startPostgresTestServer(): Promise<PostgresTestServer> {
  const child = spawn(process.execPath, [LAUNCHER, String(process.pid)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  let complaints = '';
  child.stderr.on('data', (chunk: Buffer) => {
    complaints += chunk.toString('utf8');
  });

  const stop = async (): Promise<void> => {
    child.stdin.end();
    await exited;
  };

  try {
    const announcement = await new Promise<ServerAnnouncement>(
      (resolve, reject) => {
        const lines = createInterface({ input: child.stdout });
        lines.once('line', (line) => {
          lines.close();
          try {
            resolve(readAnnouncement(line));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          reject(
            new Error(
              `The PostgreSQL test server exited with code ${code ?? 'none'}: ${complaints}`,
            ),
          );
        });
      },
    );
    return {
      connection: {
        host: HOST,
        port: announcement.port,
        user: USER,
        password: announcement.password,
        database: DATABASE,
      },
      dataDirectory: announcement.dataDirectory,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
