import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  ROLE_NAME_MIN_LENGTH,
  ROLE_NAME_PATTERN,
} from '@app/core';

describe('the role rule the forms share and the one the server applies', () => {
  // The server does not import the shared package, so its own check is read as text.
  const dto = readFileSync(
    fileURLToPath(
      new URL('../../../../../../backend/src/role/dto/create-role.dto.ts', import.meta.url),
    ),
    'utf8',
  );
  const nameRule = dto.slice(dto.indexOf('@IsString()'), dto.indexOf('name!: string;'));
  const descriptionRule = dto.slice(dto.indexOf('name!: string;'), dto.indexOf('description?:'));

  it('holds a role name to the same lengths and the same characters', () => {
    expect({
      min: nameRule.includes(`@MinLength(${ROLE_NAME_MIN_LENGTH})`),
      max: nameRule.includes(`@MaxLength(${ROLE_NAME_MAX_LENGTH})`),
      pattern: nameRule.includes(`@Matches(${String(ROLE_NAME_PATTERN)},`),
    }).toEqual({ min: true, max: true, pattern: true });
  });

  it('holds a role description to the same length', () => {
    expect(descriptionRule.includes(`@MaxLength(${ROLE_DESCRIPTION_MAX_LENGTH})`)).toBe(true);
  });
});
