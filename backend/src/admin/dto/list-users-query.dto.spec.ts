import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListUsersQueryDto } from './list-users-query.dto';
import { ListRolesQueryDto } from '../../role/dto/list-roles-query.dto';

describe('ListUsersQueryDto (D-06 & S-11)', () => {
  it('accepts search string up to 100 characters', async () => {
    const searchString = 'a'.repeat(100);
    const dto = plainToInstance(ListUsersQueryDto, { search: searchString });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'search')).toBe(false);
  });

  it('rejects search string exceeding 100 characters', async () => {
    const searchString = 'a'.repeat(101);
    const dto = plainToInstance(ListUsersQueryDto, { search: searchString });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'search')).toBe(true);
  });
});

describe('ListRolesQueryDto (S-11)', () => {
  it('accepts search string up to 100 characters', async () => {
    const searchString = 'r'.repeat(100);
    const dto = plainToInstance(ListRolesQueryDto, { search: searchString });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'search')).toBe(false);
  });

  it('rejects search string exceeding 100 characters', async () => {
    const searchString = 'r'.repeat(101);
    const dto = plainToInstance(ListRolesQueryDto, { search: searchString });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'search')).toBe(true);
  });
});
