import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddPermissionDto } from './add-permission.dto';

async function failedConstraints(permission: unknown): Promise<string[]> {
  const dto = plainToInstance(AddPermissionDto, { permission });
  const errors = await validate(dto);

  return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('AddPermissionDto (S-18)', () => {
  it.each([
    'users:read:all',
    'profile:update:own',
    'reports:read:all',
    'activity:read:all',
    'sessions:read:staff',
    'sessions:delete:staff',
    'users:suspend:staff',
    'posts:create',
  ])('should accept %s', async (permission) => {
    expect(await failedConstraints(permission)).toHaveLength(0);
  });

  it('should reject the wildcard', async () => {
    expect(await failedConstraints('*')).toContain('notEquals');
  });

  it.each([
    'Users:Read:All',
    'users read all',
    'users:',
    'users:read:all:extra',
  ])('should reject %s', async (permission) => {
    expect(await failedConstraints(permission)).toContain('matches');
  });

  it('should reject an empty value', async () => {
    expect(await failedConstraints('')).toContain('isNotEmpty');
  });

  it('should reject a non string value', async () => {
    expect(await failedConstraints(42)).toContain('isString');
  });
});
