import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ANSWERS_FILE_NAME } from '../../src/constants/index.js';
import { isRecord } from '../../src/manifest/read.js';
import type { Packed } from './packed-cli.js';
import { contents, generate } from './packed-databases.js';

const IDENTITY = {
  name: 'Round Trip',
  slug: 'round-trip',
  appId: 'org.sample.roundtrip',
  scheme: 'org.sample.round-trip',
};

// Every value differs from its default, so a mapping the replay drops cannot compare equal.
const NON_DEFAULT_FLAGS = [
  '--targets',
  'web,native-expo',
  '--database',
  'postgres',
  '--rules',
  'standard',
  '--no-docker',
  '--no-production',
  '--locales',
  'en',
  '--mobile-name',
  IDENTITY.name,
  '--mobile-slug',
  IDENTITY.slug,
  '--mobile-app-id',
  IDENTITY.appId,
  '--mobile-scheme',
  IDENTITY.scheme,
];

function recorded(project: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(project, ANSWERS_FILE_NAME), 'utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.template) || !isRecord(parsed.answers)) {
    throw new Error(`${ANSWERS_FILE_NAME} is not an answers record`);
  }
  return {
    sha256: parsed.template.sha256,
    rules: parsed.rules,
    database: parsed.answers.database,
    options: parsed.answers.options,
    locales: parsed.answers.locales,
    mobile: parsed.answers.mobile,
  };
}

export function answersRoundTripCases(getPacked: () => Packed): void {
  // Catches an answers file that cannot rebuild the exact project it describes.
  it('rebuilds the same tree from a project answers file passed to --config', () => {
    const packed = getPacked();
    const first = generate(
      packed,
      'round-trip-first/app',
      NON_DEFAULT_FLAGS,
      'email-password,google',
    );
    const second = generate(packed, 'round-trip-second/app', [
      '--config',
      join(first, ANSWERS_FILE_NAME),
    ]);
    const original = contents(first);
    const rebuilt = contents(second);

    expect({
      files: Object.keys(rebuilt).sort(),
      differing: Object.keys(original).filter((file) => rebuilt[file] !== original[file]),
      answers: recorded(second),
    }).toEqual({
      files: Object.keys(original).sort(),
      differing: [],
      answers: {
        sha256: recorded(first).sha256,
        rules: { policy: 'standard' },
        database: 'postgres',
        options: [],
        locales: ['en'],
        mobile: IDENTITY,
      },
    });
  });
}
