import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripFeatureMarkers } from '../../src/prune/markers.js';
import { linkDependencies, REPO_ROOT } from '../support/combination-helpers.js';
import { verifyFeatureAvailability } from './feature-runtime.js';

const FEATURES = ['email-password', 'magic-link', 'totp', 'passkeys'];
const SELECTIONS = Array.from({ length: 1 << FEATURES.length }, (_, mask) =>
  FEATURES.filter((_, index) => mask & (1 << index)),
);
const FILES = [
  'backend/tsconfig.json',
  'backend/src/auth/constants/available-auth-features.ts',
  'backend/src/auth/enums/auth-feature.enum.ts',
  'backend/src/auth/services/features/auth-features.service.ts',
  'backend/src/common/exceptions/app.exception.ts',
  'backend/src/common/enums/error-code.enum.ts',
];
const root = mkdtempSync(join(tmpdir(), 'auth-feature-runtime-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('generated backend feature availability', () => {
  it.each(SELECTIONS.map((selected) => ({ selected })))(
    'keeps removed methods disabled for $selected',
    ({ selected }) => {
      const project = mkdtempSync(join(root, 'selection-'));
      for (const file of FILES) {
        const source = readFileSync(join(REPO_ROOT, file), 'utf8');
        // oauth-core is hidden and never selected here, but the error-code
        // enum carries its markers, so it has to be a known id to strip.
        const { content } = stripFeatureMarkers(
          source,
          file,
          new Set(selected),
          new Set([...FEATURES, 'oauth-core']),
        );
        const destination = join(project, file);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, content);
      }
      linkDependencies(project);
      const result = verifyFeatureAvailability(project, selected);
      expect(result.ok, result.output).toBe(true);
    },
    30_000,
  );
});
