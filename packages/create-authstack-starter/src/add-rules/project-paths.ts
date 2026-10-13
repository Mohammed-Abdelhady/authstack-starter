import { constants } from 'node:fs';
import type { Dirent } from 'node:fs';
import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isErrnoException } from '../utils/fs.js';

interface CreatedDirectory {
  parent: Directory;
  name: string;
  owned?: { ino: number; dev: number };
}
interface Directory {
  handle: FileHandle;
  anchor: string;
  parent?: Directory;
  name: string;
}
function sameInode(
  left: { ino: number; dev: number },
  right: { ino: number; dev: number },
): boolean {
  return left.ino === right.ino && left.dev === right.dev;
}
function safeRelative(root: string, path: string): string {
  const value = relative(root, resolve(root, path));
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:[\\/]|^\\/.test(path) ||
    path.split(/[\\/]/).includes('..') ||
    value === '..' ||
    value.startsWith(`..${sep}`)
  )
    throw new Error(`Unsafe project path: ${path}`);
  return value;
}
async function anchored(
  handle: FileHandle,
  parent: Directory | undefined,
  name: string,
): Promise<Directory> {
  const stat = await handle.stat();
  // Both names address the opened directory, even if its original parent is replaced.
  const anchor =
    process.platform === 'darwin'
      ? `/.vol/${stat.dev}/${stat.ino}`
      : process.platform === 'linux'
        ? `/proc/self/fd/${handle.fd}`
        : undefined;
  if (anchor === undefined)
    throw new Error(
      'Safe directory-relative filesystem access requires macOS or Linux. Nothing written.',
    );
  if (!sameInode(await lstat(anchor), stat) && process.platform === 'darwin')
    throw new Error('Directory inode access is unavailable. Nothing written.');
  return { handle, anchor, parent, name };
}

export class ProjectPaths {
  private readonly directories = new Map<string, Directory>();
  private readonly created: CreatedDirectory[] = [];
  private constructor(private readonly root: string) {}

  static async open(root: string): Promise<ProjectPaths> {
    const paths = new ProjectPaths(root);
    const stat = await lstat(root);
    if (stat.isSymbolicLink()) throw new Error('Symbolic link refused: .');
    const handle = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (!sameInode(stat, await handle.stat()))
        throw new Error('Project root changed during inspection.');
      paths.directories.set('', await anchored(handle, undefined, ''));
      return paths;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async directory(path: string, create = false): Promise<Directory> {
    const key = path === '.' ? '' : path;
    const cached = this.directories.get(key);
    if (cached) return cached;
    const parent = await this.directory(dirname(key), create);
    await this.current(parent);
    const name = basename(key);
    const location = join(parent.anchor, name);
    let created: CreatedDirectory | undefined;
    try {
      await lstat(location);
    } catch (error) {
      if (!create || !isErrnoException(error) || error.code !== 'ENOENT') throw error;
      await mkdir(location);
      created = { parent, name };
      this.created.push(created);
    }
    const stat = await lstat(location);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link refused: ${path}`);
    if (!stat.isDirectory()) throw new Error(`Parent is not a directory: ${path}`);
    if (created) created.owned = stat;
    const handle = await open(
      location,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (!sameInode(stat, await handle.stat()))
        throw new Error(`Project directory changed: ${path}`);
      const directory = await anchored(handle, parent, name);
      this.directories.set(key, directory);
      return directory;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async current(directory: Directory): Promise<void> {
    if (directory.parent) await this.current(directory.parent);
    const location = directory.parent ? join(directory.parent.anchor, directory.name) : this.root;
    const stat = await lstat(location);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link refused: ${directory.name || '.'}`);
    if (!sameInode(stat, await directory.handle.stat()))
      throw new Error(`Project directory changed: ${directory.name || '.'}`);
  }

  async entries(path: string): Promise<Dirent[]> {
    const directory = await this.directory(safeRelative(this.root, path));
    await this.current(directory);
    const entries = await readdir(directory.anchor, { withFileTypes: true });
    await this.current(directory);
    return entries;
  }

  async exists(path: string): Promise<boolean> {
    const safe = safeRelative(this.root, path);
    try {
      const parent = await this.directory(dirname(safe));
      await this.current(parent);
      const stat = await lstat(safe === '' ? this.root : join(parent.anchor, basename(safe)));
      if (stat.isSymbolicLink()) throw new Error(`Symbolic link refused: ${path || '.'}`);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async read(path: string): Promise<string | undefined> {
    if (!(await this.exists(path))) return undefined;
    const parent = await this.directory(dirname(safeRelative(this.root, path)));
    const handle = await open(
      join(parent.anchor, basename(path)),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await this.current(parent);
      if (!(await handle.stat()).isFile()) throw new Error(`Not a regular file: ${path}`);
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  }

  async access(path: string, mode: number): Promise<void> {
    const safe = safeRelative(this.root, path);
    const parent = await this.directory(dirname(safe));
    await this.current(parent);
    const handle = await open(
      join(parent.anchor, basename(safe)),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!(await handle.stat()).isFile()) throw new Error(`Not a regular file: ${path}`);
      await access(join(parent.anchor, basename(safe)), mode);
      await this.verify(path, handle);
    } finally {
      await handle.close();
    }
  }

  async reserve(path: string): Promise<FileHandle> {
    const safe = safeRelative(this.root, path);
    const parent = await this.directory(dirname(safe), true);
    await this.current(parent);
    return open(
      join(parent.anchor, basename(safe)),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o644,
    );
  }

  async verify(path: string, handle: FileHandle): Promise<void> {
    const parent = await this.directory(dirname(safeRelative(this.root, path)));
    await this.current(parent);
    const stat = await lstat(join(parent.anchor, basename(path)));
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link refused: ${path}`);
    if (!sameInode(stat, await handle.stat()))
      throw new Error(`Reserved file was replaced: ${path}`);
  }

  async discard(path: string, handle: FileHandle): Promise<void> {
    const parent = await this.directory(dirname(safeRelative(this.root, path)));
    const location = join(parent.anchor, basename(path));
    let stat;
    try {
      stat = await lstat(location);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isSymbolicLink() && sameInode(stat, await handle.stat()))
      await this.removeOwned(location, await handle.stat(), false);
  }

  private async removeOwned(
    location: string,
    owned: { ino: number; dev: number },
    directory: boolean,
  ): Promise<void> {
    // Rename captures the current entry atomically before checking its identity again.
    if (directory) {
      const handle = await open(
        location,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        if (!sameInode(await handle.stat(), owned)) return;
        const opened = await anchored(handle, undefined, '');
        if ((await readdir(opened.anchor)).length > 0) return;
      } finally {
        await handle.close();
      }
    }
    const recovery = await mkdtemp(join(dirname(location), '.rules-rollback-'));
    const recoveryStat = await lstat(recovery);
    if (recoveryStat.isSymbolicLink())
      throw new Error('Symbolic link refused in rollback recovery.');
    const recoveryHandle = await open(
      recovery,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (!sameInode(recoveryStat, await recoveryHandle.stat()))
        throw new Error('Rollback recovery directory changed.');
      const pinned = await anchored(recoveryHandle, undefined, '');
      const captured = join(pinned.anchor, 'entry');
      const persistent = join(
        process.platform === 'linux' ? await realpath(pinned.anchor) : recovery,
        'entry',
      );
      let failure: unknown;
      try {
        await rename(location, captured);
        const stat = await lstat(captured);
        if (!sameInode(stat, owned) || stat.isSymbolicLink()) {
          if (directory)
            throw new Error(`Competing directory preserved at ${persistent}. Restore it manually.`);
          try {
            await link(captured, location);
          } catch {
            throw new Error(`Competing file preserved at ${persistent}. Restore it manually.`);
          }
          await unlink(captured);
        } else if (directory) await rmdir(captured);
        else await unlink(captured);
      } catch (error) {
        failure = error;
      }
      try {
        const current = await lstat(recovery);
        if (current.isSymbolicLink() || !sameInode(current, recoveryStat))
          throw new Error('Rollback recovery directory changed; retained contents need attention.');
        try {
          await rmdir(recovery);
        } catch (error) {
          if (!isErrnoException(error) || error.code !== 'ENOTEMPTY') throw error;
        }
      } catch (error) {
        if (failure !== undefined) throw new Error(`${String(failure)}. ${String(error)}`);
        throw error;
      }
      if (failure !== undefined) throw failure;
    } finally {
      await recoveryHandle.close();
    }
  }

  async discardDirectories(): Promise<string[]> {
    const failures: string[] = [];
    for (const directory of [...this.created].reverse()) {
      const parent = directory.parent;
      try {
        const owned = directory.owned;
        if (!owned) throw new Error('Directory reservation identity could not be inspected.');
        for (const entry of await readdir(parent.anchor)) {
          const location = join(parent.anchor, entry);
          const stat = await lstat(location);
          if (!stat.isSymbolicLink() && sameInode(stat, owned))
            await this.removeOwned(location, owned, true);
        }
      } catch (error) {
        failures.push(
          `${directory.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return failures;
  }

  async close(): Promise<void> {
    for (const directory of [...this.directories.values()].reverse())
      await directory.handle.close();
  }
}
