import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MOBILE_APP_CONFIG_FILES,
  NATIVE_APPLICATIONS_VAR,
  NATIVE_REGISTRATION_FILES,
} from '../constants/mobile.js';
import { isRecord } from '../manifest/read.js';
import { formatChangedFiles } from '../prune/format.js';
import type { MobileIdentity } from '../types/mobile.js';
import { readFileIfExists } from '../utils/fs.js';
import { parseJson } from '../utils/parse-json.js';
import { callbackAddress } from './identity.js';

function section(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return isRecord(value) ? value : {};
}

/** The app config with the identity in place. Every other key keeps its value. Pure. */
export function withMobileIdentity(
  appConfig: Record<string, unknown>,
  identity: MobileIdentity,
): Record<string, unknown> {
  const expo = section(appConfig, 'expo');
  return {
    ...appConfig,
    expo: {
      ...expo,
      name: identity.name,
      slug: identity.slug,
      scheme: identity.scheme,
      ios: { ...section(expo, 'ios'), bundleIdentifier: identity.appId },
      android: { ...section(expo, 'android'), package: identity.appId },
    },
  };
}

/**
 * The server's registration for the app as one env value. It sits between
 * single quotes in an env file and in a shell block, so a quote in the name is
 * written as its JSON escape and nothing can close the quotes early.
 */
export function nativeRegistration(identity: MobileIdentity): string {
  const applications = [
    {
      clientId: identity.scheme,
      displayName: identity.name,
      redirectUris: [callbackAddress(identity.scheme)],
    },
  ];
  return `'${JSON.stringify(applications).replaceAll("'", '\\u0027')}'`;
}

const REGISTRATION_LINE = new RegExp(
  `^([\\t ]*)(?:#[\\t ]*)?${NATIVE_APPLICATIONS_VAR}='[^'\\r\\n]*'[\\t ]*$`,
  'gm',
);

/** Every example registration in a file, switched on and pointed at this app. Pure. */
export function withNativeRegistration(
  content: string,
  identity: MobileIdentity,
): { content: string; replaced: number } {
  let replaced = 0;
  const line = `${NATIVE_APPLICATIONS_VAR}=${nativeRegistration(identity)}`;
  const updated = content.replace(REGISTRATION_LINE, (_match, indent: string) => {
    replaced += 1;
    return `${indent}${line}`;
  });
  return { content: updated, replaced };
}

async function writeAppConfig(root: string, file: string, identity: MobileIdentity): Promise<void> {
  const path = join(root, file);
  const raw = await readFileIfExists(path);
  if (raw === undefined) throw new Error(`${file} is missing, so the mobile app cannot be named.`);
  const parsed = parseJson(raw, file);
  if (!isRecord(parsed)) throw new Error(`${file} must hold a JSON object.`);
  await writeFile(
    path,
    `${JSON.stringify(withMobileIdentity(parsed, identity), null, 2)}\n`,
    'utf8',
  );
}

/**
 * Writes the identity into each chosen app's config, the one place the app
 * reads it from, and into the example registrations the server and the docs
 * carry. Returns the files it changed.
 */
export async function applyMobileIdentity(
  root: string,
  targets: readonly string[],
  identity: MobileIdentity,
): Promise<string[]> {
  const edited: string[] = [];
  for (const target of targets) {
    if (!Object.hasOwn(MOBILE_APP_CONFIG_FILES, target)) continue;
    const file = MOBILE_APP_CONFIG_FILES[target];
    await writeAppConfig(root, file, identity);
    edited.push(file);
  }

  for (const file of NATIVE_REGISTRATION_FILES) {
    const path = join(root, file);
    const content = await readFileIfExists(path);
    // An option that is off takes its env example with it.
    if (content === undefined) continue;
    const result = withNativeRegistration(content, identity);
    if (result.replaced === 0) {
      throw new Error(
        `${file} has no ${NATIVE_APPLICATIONS_VAR} example to point at the mobile app.`,
      );
    }
    await writeFile(path, result.content, 'utf8');
    edited.push(file);
  }

  await formatChangedFiles(root, edited);
  return edited;
}
