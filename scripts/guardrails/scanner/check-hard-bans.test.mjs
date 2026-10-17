import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FILE_LINE_LIMIT,
  evaluateChanges,
  findAttributionHits,
  findBannedToken,
  isCappedPath,
  isScanTarget,
  parseUnifiedDiff,
  stripAttribution,
} from '../../check-hard-bans.mjs';

function added(filePath, lines, lineStart = 1) {
  return {
    path: filePath,
    addedLines: lines.map((text, index) => ({ line: lineStart + index, text })),
  };
}

test('added eslint-disable fails', () => {
  const result = evaluateChanges({
    added: [added('backend/src/app.ts', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'backend/src/app.ts', lines: 10 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.bans[0].token, 'eslint-disable');
});

test('added as any fails', () => {
  const result = evaluateChanges({
    added: [added('frontend/src/lib/parse.ts', ['const value = data as any;'])],
    lineCounts: [{ path: 'frontend/src/lib/parse.ts', lines: 10 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.bans[0].token, 'as any');
});

test('has any does not match as any', () => {
  assert.equal(findBannedToken('Check if a user has any of the required permissions'), null);
  assert.equal(findBannedToken('const value = data as any;'), 'as any');
});

test('added dangerouslySetInnerHTML fails', () => {
  const result = evaluateChanges({
    added: [
      added('frontend/src/ui/Html.tsx', [
        'return <div dangerouslySetInnerHTML={{ __html: html }} />;',
      ]),
    ],
    lineCounts: [{ path: 'frontend/src/ui/Html.tsx', lines: 10 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.bans[0].token, 'dangerouslySetInnerHTML');
});

test('denial assertion in a test file is allowed', () => {
  const result = evaluateChanges({
    added: [
      added('frontend/src/ui/Html.test.tsx', [
        "expect(source).not.toContain('dangerouslySetInnerHTML');",
      ]),
    ],
    lineCounts: [{ path: 'frontend/src/ui/Html.test.tsx', lines: 20 }],
  });
  assert.equal(result.ok, true);
});

test('real banned usage in a test file fails', () => {
  const result = evaluateChanges({
    added: [added('frontend/src/ui/Html.test.tsx', ["el.innerHTML = '<p>x</p>';"])],
    lineCounts: [{ path: 'frontend/src/ui/Html.test.tsx', lines: 20 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.bans[0].token, 'innerHTML');
});

test('markdown is not a scan target', () => {
  assert.equal(isScanTarget('docs/reference/code-quality.md'), false);
  const result = evaluateChanges({
    added: [added('docs/reference/code-quality.md', ['eslint-disable and --no-verify'])],
    lineCounts: [],
  });
  assert.equal(result.ok, true);
});

test('checker entry is scanned after data moves to policy', () => {
  const result = evaluateChanges({
    added: [added('scripts/check-hard-bans.mjs', ['const token = "as any";'])],
    lineCounts: [],
  });
  assert.equal(result.ok, false);
});

test('line cap: 350 passes and 351 fails under src', () => {
  const atLimit = evaluateChanges({
    added: [added('backend/src/long.ts', ['export {};'])],
    lineCounts: [{ path: 'backend/src/long.ts', lines: FILE_LINE_LIMIT }],
  });
  assert.equal(atLimit.ok, true);

  const over = evaluateChanges({
    added: [added('backend/src/long.ts', ['export {};'])],
    lineCounts: [{ path: 'backend/src/long.ts', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(over.ok, false);
  assert.equal(over.caps[0].lines, FILE_LINE_LIMIT + 1);
});

test('the adapter conformance suite is capped like source files', () => {
  assert.equal(isCappedPath('mobile/auth/conformance/credentials.ts'), true);
  assert.equal(isCappedPath('mobile/auth/conformance-notes/credentials.ts'), false);
  const over = evaluateChanges({
    added: [added('mobile/auth/conformance/credentials.ts', ['export {};'])],
    lineCounts: [{ path: 'mobile/auth/conformance/credentials.ts', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(over.ok, false);
});

test('root scripts over the cap are gated', () => {
  assert.equal(isCappedPath('scripts/init.js'), true);
  const result = evaluateChanges({
    added: [added('scripts/init.js', ['console.log(1);'])],
    lineCounts: [{ path: 'scripts/init.js', lines: 500 }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.caps, [{ path: 'scripts/init.js', lines: 500 }]);
});

test('parseUnifiedDiff reads added lines only', () => {
  const files = parseUnifiedDiff(`diff --git a/backend/src/a.ts b/backend/src/a.ts
--- a/backend/src/a.ts
+++ b/backend/src/a.ts
@@ -1,0 +2,2 @@
+const ok = true;
+const also = true;
`);
  assert.equal(files[0].path, 'backend/src/a.ts');
  assert.deepEqual(
    files[0].addedLines.map((row) => row.text),
    ['const ok = true;', 'const also = true;'],
  );
  assert.equal(files[0].addedLines[0].line, 2);
});

test('commit message attribution is stripped and leftover hits fail', () => {
  assert.equal(findAttributionHits('feat(root): add local gates\n').length, 0);
  const injected =
    'feat(root): add local gates\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n';
  assert.ok(findAttributionHits(injected).length > 0);
  const stripped = stripAttribution(injected);
  assert.equal(findAttributionHits(stripped).length, 0);
  assert.equal(stripped.includes('Co-authored-by'), false);
  assert.ok(findAttributionHits('feat: x\n\nGenerated with Claude\n').length > 0);
});

test('shared core src is capped', () => {
  assert.equal(isCappedPath('shared/core/src/index.ts'), true);
  const atLimit = evaluateChanges({
    added: [added('shared/core/src/index.ts', ['export {};'])],
    lineCounts: [{ path: 'shared/core/src/index.ts', lines: FILE_LINE_LIMIT }],
  });
  assert.equal(atLimit.ok, true);

  const over = evaluateChanges({
    added: [added('shared/core/src/index.ts', ['export {};'])],
    lineCounts: [{ path: 'shared/core/src/index.ts', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(over.ok, false);
  assert.equal(over.caps[0].lines, FILE_LINE_LIMIT + 1);
});

test('mobile core src is capped', () => {
  assert.equal(isCappedPath('mobile/core/src/index.ts'), true);
  const atLimit = evaluateChanges({
    added: [added('mobile/core/src/index.ts', ['export {};'])],
    lineCounts: [{ path: 'mobile/core/src/index.ts', lines: FILE_LINE_LIMIT }],
  });
  assert.equal(atLimit.ok, true);

  const over = evaluateChanges({
    added: [added('mobile/core/src/index.ts', ['export {};'])],
    lineCounts: [{ path: 'mobile/core/src/index.ts', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(over.ok, false);
  assert.equal(over.caps[0].lines, FILE_LINE_LIMIT + 1);
});

test('mobile expo app is capped', () => {
  assert.equal(isCappedPath('mobile/expo/app/index.tsx'), true);
  const atLimit = evaluateChanges({
    added: [added('mobile/expo/app/index.tsx', ['export {};'])],
    lineCounts: [{ path: 'mobile/expo/app/index.tsx', lines: FILE_LINE_LIMIT }],
  });
  assert.equal(atLimit.ok, true);

  const over = evaluateChanges({
    added: [added('mobile/expo/app/index.tsx', ['export {};'])],
    lineCounts: [{ path: 'mobile/expo/app/index.tsx', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(over.ok, false);
  assert.equal(over.caps[0].lines, FILE_LINE_LIMIT + 1);
});

test('expo prebuild output is not scanned', () => {
  assert.equal(isScanTarget('mobile/expo/ios/Pods/helper.js'), false);
  assert.equal(isScanTarget('mobile/expo/android/app/build.js'), false);
  assert.equal(isScanTarget('mobile/expo/.expo/cache.js'), false);
  assert.equal(isScanTarget('mobile/undeclared/.expo/cache.js'), true);
  const ios = evaluateChanges({
    added: [added('mobile/expo/ios/Pods/helper.js', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'mobile/expo/ios/Pods/helper.js', lines: 10 }],
  });
  assert.equal(ios.ok, true);
  const android = evaluateChanges({
    added: [added('mobile/expo/android/app/build.js', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'mobile/expo/android/app/build.js', lines: 10 }],
  });
  assert.equal(android.ok, true);
  const cache = evaluateChanges({
    added: [added('mobile/undeclared/.expo/cache.js', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'mobile/undeclared/.expo/cache.js', lines: 10 }],
  });
  assert.equal(cache.ok, false);
});

test('hand-written native source is still scanned', () => {
  assert.equal(isScanTarget('mobile/cli/ios/scripts/bundle.sh'), true);
  assert.equal(isScanTarget('mobile/device-key/android/scripts/gen.js'), true);
  assert.equal(isScanTarget('frontend/src/modules/android/install.ts'), true);
  assert.equal(isScanTarget('frontend/mobile/expo/ios/Pods/helper.js'), true);
  const cli = evaluateChanges({
    added: [added('mobile/cli/ios/scripts/bundle.sh', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'mobile/cli/ios/scripts/bundle.sh', lines: 10 }],
  });
  assert.equal(cli.ok, false);
  assert.equal(cli.bans[0].token, 'eslint-disable');
  const module = evaluateChanges({
    added: [added('mobile/device-key/android/scripts/gen.js', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'mobile/device-key/android/scripts/gen.js', lines: 10 }],
  });
  assert.equal(module.ok, false);
  assert.equal(module.bans[0].token, 'eslint-disable');
  const frontend = evaluateChanges({
    added: [added('frontend/src/modules/android/install.ts', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'frontend/src/modules/android/install.ts', lines: 10 }],
  });
  assert.equal(frontend.ok, false);
  assert.equal(frontend.bans[0].token, 'eslint-disable');
  const nested = evaluateChanges({
    added: [added('frontend/mobile/expo/ios/Pods/helper.js', ['/* eslint-disable no-console */'])],
    lineCounts: [{ path: 'frontend/mobile/expo/ios/Pods/helper.js', lines: 10 }],
  });
  assert.equal(nested.ok, false);
  assert.equal(nested.bans[0].token, 'eslint-disable');
});

test('mobile readme and shared scripts are not capped', () => {
  assert.equal(isCappedPath('mobile/core/README.md'), false);
  assert.equal(isCappedPath('shared/core/scripts/generate.ts'), false);
  const readme = evaluateChanges({
    added: [added('mobile/core/README.md', ['docs'])],
    lineCounts: [{ path: 'mobile/core/README.md', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(readme.ok, true);
  const script = evaluateChanges({
    added: [added('shared/core/scripts/generate.ts', ['export {};'])],
    lineCounts: [{ path: 'shared/core/scripts/generate.ts', lines: FILE_LINE_LIMIT + 1 }],
  });
  assert.equal(script.ok, true);
});

test('added as any under mobile src fails', () => {
  const result = evaluateChanges({
    added: [added('mobile/core/src/parse.ts', ['const value = data as any;'])],
    lineCounts: [{ path: 'mobile/core/src/parse.ts', lines: 10 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.bans[0].token, 'as any');
});
