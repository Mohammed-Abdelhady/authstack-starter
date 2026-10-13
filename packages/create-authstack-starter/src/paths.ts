import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_DIR_NAME } from './constants/index.js';

/**
 * The bundle lives in dist/, so the package root is one level up. template/ and
 * template.manifest.json sit next to dist/ and ship with the tarball.
 */
export function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function templateDir(): string {
  return join(packageRoot(), TEMPLATE_DIR_NAME);
}
