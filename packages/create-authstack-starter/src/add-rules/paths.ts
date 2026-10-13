import { ProjectPaths } from './project-paths.js';

export async function checkPath(root: string, path: string): Promise<boolean> {
  const paths = await ProjectPaths.open(root);
  try {
    return await paths.exists(path);
  } finally {
    await paths.close();
  }
}

export async function inspectFile(root: string, path: string): Promise<string | undefined> {
  const paths = await ProjectPaths.open(root);
  try {
    return await paths.read(path);
  } finally {
    await paths.close();
  }
}
