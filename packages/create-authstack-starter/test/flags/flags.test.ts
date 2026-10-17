import { describe, expect, it } from 'vitest';
import { parseCliOptions } from '../../src/flags/options.js';

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

  it('turns off install and git', () => {
    const options = parseCliOptions(['app', '--no-install', '--no-git']);
    expect(options.install).toBe(false);
    expect(options.git).toBe(false);
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
