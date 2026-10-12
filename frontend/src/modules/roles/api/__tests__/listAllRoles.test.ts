// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@app/core';
import { unreachable } from '@/tests/busyControls';
import { listedRole, manyRoles, pageAsked, rolesPage } from '@/tests/roleList';
import {
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { rolesApi } from '../rolesApi';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

type Respond = (request: Request, page: number) => Response;

/** Reads every role once, answering each page through `respond`, and reports what was asked. */
async function readAll(respond: Respond) {
  const asked: Array<{ page: number; limit: number }> = [];
  stubNetwork((request) => {
    asked.push(pageAsked(request));
    return respond(request, pageAsked(request).page);
  });
  const result = await makeStore().dispatch(
    rolesApi.endpoints.listAllRoles.initiate(undefined, { subscribe: false }),
  );
  return {
    asked,
    names: result.data?.map((role) => role.name),
    failed: result.isError,
    error: result.error,
  };
}

const pages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ page: index + 1, limit: 100 }));

const nameRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `Role ${from + index}`);

registerFormTestLifecycle();

describe('reading every role', () => {
  it.each([
    ['no role at all', 0, 1],
    ['one role', 1, 1],
    ['exactly one page', 100, 1],
    ['one page and one more role', 101, 2],
    ['three pages', 250, 3],
  ])('returns them all, in order, for %s', async (_name, count, requests) => {
    const roles = manyRoles(count);

    const read = await readAll((request) => rolesPage(request, roles));

    expect(read.asked).toEqual(pages(requests));
    expect(read.names).toEqual(count === 0 ? [] : nameRange(1, count));
    expect(read.failed).toBe(false);
  });

  it.each([
    ['refuses', () => refusalWith(500, ErrorCode.INTERNAL_ERROR)],
    ['cannot be reached for', unreachable],
  ])('fails, with no shorter list, when the server %s a later page', async (_name, fail) => {
    const roles = manyRoles(250);

    const read = await readAll((request, page) =>
      page === 2 ? fail() : rolesPage(request, roles),
    );

    expect(read.asked).toEqual(pages(2));
    expect(read.failed).toBe(true);
    expect(read.names).toBeUndefined();
  });

  it('fails when the first page fails', async () => {
    const read = await readAll(() => refusalWith(403, ErrorCode.FORBIDDEN));

    expect(read.asked).toEqual(pages(1));
    expect(read.failed).toBe(true);
    expect(read.names).toBeUndefined();
  });

  it('stops at twenty pages and fails when the list is longer than they hold', async () => {
    const roles = manyRoles(2001);

    const read = await readAll((request) => rolesPage(request, roles));

    expect(read.asked).toEqual(pages(20));
    expect(read.failed).toBe(true);
    expect(read.error).toEqual({ status: 'CUSTOM_ERROR', error: 'ROLE_LIST_TOO_LONG' });
    expect(read.names).toBeUndefined();
  });

  it('reads all twenty pages of a list that just fits', async () => {
    const roles = manyRoles(2000);

    const read = await readAll((request) => rolesPage(request, roles));

    expect(read.asked).toEqual(pages(20));
    expect(read.names?.length).toBe(2000);
    expect(read.failed).toBe(false);
  });

  it('keeps a role once when the list shifts between two pages and sends it twice', async () => {
    const first = [listedRole('editor', 'Editor'), listedRole('writer', 'Writer')];
    const second = [listedRole('writer', 'Writer'), listedRole('viewer', 'Viewer')];

    const read = await readAll((_request, page) =>
      success({ roles: page === 1 ? first : second, total: 3, page, pages: 2 }),
    );

    expect(read.names).toEqual(['Editor', 'Writer', 'Viewer']);
  });

  it('counts the pages from the total when the server does not say how many there are', async () => {
    const roles = manyRoles(150);

    const read = await readAll((request, page) =>
      success({ roles: roles.slice((page - 1) * 100, page * 100), total: 150, page }),
    );

    expect(read.asked).toEqual(pages(2));
    expect(read.names).toEqual(nameRange(1, 150));
  });
});
