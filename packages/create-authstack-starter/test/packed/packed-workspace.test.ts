import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparePackedWorkspace } from './packed-workspace.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('packed workspace setup failures', () => {
  it.each(['mkdirSync', 'writeFileSync', 'chmodSync'] as const)(
    'removes the workspace and propagates a %s failure',
    (step) => {
      const root = mkdtempSync(join(tmpdir(), 'cna-setup-test-'));
      roots.push(root);
      const failure = new Error('Setup failed');
      const filesystem = {
        mkdirSync,
        writeFileSync,
        chmodSync,
        [step]: () => {
          throw failure;
        },
      };

      let caught: unknown;
      try {
        preparePackedWorkspace(root, filesystem);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect(readdirSync(root)).toEqual([]);
    },
  );
});
