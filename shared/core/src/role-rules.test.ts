import { describe, expect, it } from 'vitest';
import { isRoleDescriptionTooLong, roleNameProblem, roleSlug } from './role-rules';

describe('what is wrong with a role name', () => {
  it.each([
    ['Content Editor'],
    ['24-7 Support'],
    ['QA'],
    ['a'.repeat(50)],
    ['Night  Shift'],
    ['-- 9'],
    ['-a'],
    ['a-'],
  ])('is nothing for %j', (name) => {
    expect(roleNameProblem(name)).toBeNull();
  });

  it.each([
    ['', 'required'],
    ['A', 'tooShort'],
    ['7', 'tooShort'],
    ['a'.repeat(51), 'tooLong'],
    ['Редактор', 'characters'],
    ['Я', 'characters'],
    ['Éditeur', 'characters'],
    ['24/7 Support', 'characters'],
    ['Editor_2', 'characters'],
    ['Editor!', 'characters'],
    ['编辑', 'characters'],
    [`${'a'.repeat(60)}!`, 'characters'],
    ['--', 'codeTooShort'],
    ['- -', 'codeTooShort'],
    ['---  ---', 'codeTooShort'],
  ])('for %j is %s', (name, problem) => {
    expect(roleNameProblem(name)).toBe(problem);
  });
});

describe('a role description that is too long', () => {
  it.each([
    ['', false],
    ['Answers tickets', false],
    ['Описание роли', false],
    ['a'.repeat(200), false],
    ['a'.repeat(201), true],
  ])('%j: %s', (description, tooLong) => {
    expect(isRoleDescriptionTooLong(description)).toBe(tooLong);
  });
});

describe('the code made from a role name', () => {
  it.each([
    ['Content Editor', 'content-editor'],
    ['QA', 'qa'],
    ['24-7 Support', '24-7-support'],
    ['24 7 Support', '24-7-support'],
    ['  Night   Shift ', 'night-shift'],
    ['A--B', 'a-b'],
    ['a - b', 'a-b'],
    ['-- 9', '-9'],
    ['--', '-'],
    ['- -', '-'],
    ['Editor!', 'editor'],
    ['Tab\tSeparated', 'tab-separated'],
    [' ', ''],
    ['', ''],
  ])('of %j is %j', (name, code) => {
    expect(roleSlug(name)).toBe(code);
  });
});
