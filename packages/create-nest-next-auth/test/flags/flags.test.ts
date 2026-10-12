import { describe, expect, it } from 'vitest';
import { parseCliOptions, splitList } from '../../src/flags/options.js';

describe('parseCliOptions', () => {
  it('defaults to install and git with no directory', () => {
    expect(parseCliOptions([])).toEqual({
      directory: undefined,
      yes: false,
      rules: undefined,
      features: undefined,
      targets: undefined,
      databases: undefined,
      preset: undefined,
      config: undefined,
      dryRun: false,
      locales: undefined,
      optionOverrides: {},
      install: true,
      git: true,
    });
  });

  it('reads the directory argument', () => {
    expect(parseCliOptions(['my-app']).directory).toBe('my-app');
  });

  it('accepts an absolute path as the directory', () => {
    expect(parseCliOptions(['/tmp/cna-smoke']).directory).toBe('/tmp/cna-smoke');
  });

  it('turns off install and git', () => {
    const options = parseCliOptions(['app', '--no-install', '--no-git']);
    expect(options.install).toBe(false);
    expect(options.git).toBe(false);
  });

  it('reads --yes and --features together', () => {
    const options = parseCliOptions(['app', '--yes', '--features', 'email-password,google']);
    expect(options.yes).toBe(true);
    expect(options.features).toEqual(['email-password', 'google']);
  });

  it('reads the client, database, preset, config and locale flags', () => {
    const options = parseCliOptions([
      'app',
      '--targets',
      'web,native-expo',
      '--database',
      'mongodb',
      '--preset',
      'minimal',
      '--config',
      'choices.json',
      '--locales',
      'en,ar',
      '--dry-run',
    ]);
    expect(options.targets).toEqual(['web', 'native-expo']);
    expect(options.databases).toEqual(['mongodb']);
    expect(options.preset).toBe('minimal');
    expect(options.config).toBe('choices.json');
    expect(options.locales).toEqual(['en', 'ar']);
    expect(options.dryRun).toBe(true);
  });

  it('turns an option off only when its negative flag was passed', () => {
    expect(parseCliOptions(['app']).optionOverrides).toEqual({});
    expect(parseCliOptions(['app', '--no-docker', '--no-production']).optionOverrides).toEqual({
      docker: false,
      production: false,
    });
  });

  it('rejects an unknown flag', () => {
    expect(() => parseCliOptions(['app', '--turbo'])).toThrow();
  });

  it('rejects a second positional argument', () => {
    expect(() => parseCliOptions(['app', 'extra'])).toThrow();
  });
});

describe('splitList', () => {
  it('trims, lowercases and drops empty entries', () => {
    expect(splitList(' Google , github ,, ')).toEqual(['google', 'github']);
  });
});
