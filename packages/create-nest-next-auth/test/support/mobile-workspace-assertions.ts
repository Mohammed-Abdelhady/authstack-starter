import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { parse } from 'yaml';
import { findForbiddenContent } from './reference-content.js';

/** Every folder under `mobile/` in this repository. */
export const MOBILE_FOLDERS = [
  'mobile/adapters',
  'mobile/auth',
  'mobile/cli',
  'mobile/device-key',
  'mobile/expo',
  'mobile/metro',
  'mobile/ui',
];

/** What the Expo app needs: itself and the shared packages. */
export const EXPO_FOLDERS = MOBILE_FOLDERS.filter((folder) => folder !== 'mobile/cli');

/**
 * A reference to the mobile workspaces: a path into one of them, written plainly
 * or inside a pattern, or one of their package names. The word "mobile" alone is
 * not one: the web app has a mobile menu and the server names mobile devices.
 */
export const MOBILE_WORKSPACE_REFERENCES = [
  /(?<![A-Za-z0-9_-])mobile\\?\/(?:\*|\[|adapters|auth|cli|device-key|expo|metro|ui)/,
  /@app\/(?:native-auth|native-ui|native-adapters|device-key|metro-config|mobile-expo|mobile-cli)\b/,
];

/** A reference to the bare React Native app, which is not offered. */
export const BARE_APP_REFERENCES = [
  /(?<![A-Za-z0-9_-])mobile\\?\/cli\b/,
  /@app\/mobile-cli\b/,
  /mobilecli/,
  /React Native CLI/,
];

/** Paths of the server feature and the web pages a mobile app signs in through. */
export const SIGN_IN_SITE_PATHS = [
  'backend/src/session/native/oauth/native-oauth.controller.ts',
  'frontend/src/app/[locale]/(auth)/auth/native/authorize/page.tsx',
  'frontend/src/modules/auth/native/NativeAuthorizePanel.tsx',
  'frontend/src/app/[locale]/(auth)/auth/login/page.tsx',
];

/** Suites that drive the engine against the real server stay in this repository. */
export const REPOSITORY_ONLY_ENGINE_FILES = [
  'backend/test/native/engine/native-auth-engine.e2e-spec.ts',
  'backend/test/native/engine/native-auth-engine-dpop.e2e-spec.ts',
  'backend/test/utils/native/native-auth-engine-harness.ts',
];

interface Workspace {
  packages: string[];
  minimumReleaseAgeExclude?: string[];
  minimumReleaseAgeStrict?: boolean;
}

function readJson<T>(project: string, path: string): T {
  return JSON.parse(readFileSync(join(project, path), 'utf8')) as T;
}

/** The mobile folders a project has, and how its workspace files list them. */
export function mobileLayout(project: string): {
  folders: string[];
  rootWorkspaces: string[];
  workspacePatterns: string[];
  releaseAgeExceptions: string[];
  releaseAgeStrict: boolean | undefined;
} {
  const root = readJson<{ workspaces?: string[] }>(project, 'package.json');
  const workspace = parse(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8')) as Workspace;
  return {
    folders: MOBILE_FOLDERS.filter((folder) => existsSync(join(project, folder))),
    rootWorkspaces: (root.workspaces ?? []).filter((entry) => entry.startsWith('mobile')),
    workspacePatterns: workspace.packages.filter((pattern) => pattern.startsWith('mobile')),
    releaseAgeExceptions: workspace.minimumReleaseAgeExclude ?? [],
    releaseAgeStrict: workspace.minimumReleaseAgeStrict,
  };
}

/** A web project: no mobile folder, and no file that refers to one. */
export function expectNoMobileWorkspace(project: string): void {
  expect(existsSync(join(project, 'mobile'))).toBe(false);
  expect(mobileLayout(project)).toEqual({
    folders: [],
    rootWorkspaces: [],
    workspacePatterns: [],
    releaseAgeExceptions: [],
    releaseAgeStrict: true,
  });
  expect(
    readJson<{ devDependencies?: Record<string, string> }>(project, 'backend/package.json')
      .devDependencies?.['@app/native-auth'],
  ).toBeUndefined();
  expect(findForbiddenContent(project, MOBILE_WORKSPACE_REFERENCES)).toEqual([]);
}

/** A project with the Expo app: its workspaces, and nothing of the bare app. */
export function expectExpoWorkspace(project: string): void {
  expect(mobileLayout(project)).toEqual({
    folders: EXPO_FOLDERS,
    rootWorkspaces: EXPO_FOLDERS,
    workspacePatterns: ['mobile/*'],
    releaseAgeExceptions: [],
    releaseAgeStrict: true,
  });
  expect(findForbiddenContent(project, BARE_APP_REFERENCES)).toEqual([]);
  expect(
    readJson<{ devDependencies?: Record<string, string> }>(project, 'backend/package.json')
      .devDependencies?.['@app/native-auth'],
  ).toBeUndefined();
  expect(SIGN_IN_SITE_PATHS.filter((path) => !existsSync(join(project, path)))).toEqual([]);
}

export function expectEngineSuitesStayInRepository(project: string): void {
  expect(REPOSITORY_ONLY_ENGINE_FILES.filter((path) => existsSync(join(project, path)))).toEqual(
    [],
  );
}
