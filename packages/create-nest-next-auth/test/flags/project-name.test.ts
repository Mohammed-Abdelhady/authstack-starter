import { describe, expect, it } from 'vitest';
import { toPackageName, validateProjectName } from '../../src/utils/project-name.js';

describe('validateProjectName', () => {
  it.each(['my-app', 'app', 'my_app', 'app2', 'MyApp'])('accepts %s', (name) => {
    expect(validateProjectName(name).valid).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['.', 'current directory'],
    ['..', 'parent directory'],
    ['my app', 'a space'],
    ['my/app', 'a slash'],
    ['my\\app', 'a backslash'],
    ['my:app', 'a colon'],
    ['app*', 'a star'],
    ['.hidden', 'a leading dot'],
    ['app.', 'a trailing dot'],
    ['con', 'a reserved windows name'],
  ])('rejects %s (%s)', (name) => {
    const check = validateProjectName(name);
    expect(check.valid).toBe(false);
    expect(check.message).toBeTruthy();
  });

  it('rejects a name longer than 214 characters', () => {
    expect(validateProjectName('a'.repeat(215)).valid).toBe(false);
  });
});

describe('toPackageName', () => {
  it.each([
    ['My App', 'my-app'],
    ['MyApp', 'myapp'],
    ['.hidden', 'hidden'],
    ['my--app', 'my-app'],
    ['---', 'app'],
  ])('turns %s into %s', (input, expected) => {
    expect(toPackageName(input)).toBe(expected);
  });
});
