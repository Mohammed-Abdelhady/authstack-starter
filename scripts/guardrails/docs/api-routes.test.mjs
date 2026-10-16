import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { globalPrefix } from './http-prefix.mjs';
import { ACCESS, controllerRoutes, permissionConstants } from './controller-routes.mjs';

export { globalPrefix };

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BACKEND_SOURCE = 'backend/src';
const ROUTES_DOC = 'backend/docs/api-routes.md';
const PERMISSIONS_FILE = 'backend/src/common/constants/permissions.ts';
const BOOTSTRAP_FILE = 'backend/src/common/security/configure-http-application.ts';
const HTTP_ROUTES_FILE = 'backend/src/common/constants/http-routes.ts';
const CONTROLLER_SUFFIX = '.controller.ts';
const DOC_ROW = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|/;
const CODE_SPAN = /`([^`]+)`/g;

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Every route row of the documented tables. A trailing marker cell is ignored. */
export function documentedRoutes(markdown) {
  return markdown
    .split('\n')
    .filter((line) => DOC_ROW.test(line))
    .map((line) => {
      const [method, path, access, closedBy] = line
        .split('|')
        .slice(1)
        .map((cell) => cell.trim());
      const spans = (cell) => [...cell.matchAll(CODE_SPAN)].map(([, text]) => text);
      return {
        method,
        path: spans(path)[0] ?? path,
        access: spans(access).length > 0 ? spans(access) : [access],
        closedBy: spans(closedBy)[0] ?? null,
      };
    });
}

const routeKey = ({ method, path }) => `${method} ${path}`;

/** What differs between the routes in the code and the routes in the document. */
export function routeTableProblems(coded, documented) {
  const problems = [];
  const rows = new Map();
  for (const row of documented) {
    if (rows.has(routeKey(row))) problems.push(`${routeKey(row)} is documented twice`);
    rows.set(routeKey(row), row);
  }
  const served = new Set(coded.map(routeKey));
  for (const route of coded) {
    const row = rows.get(routeKey(route));
    if (!row) {
      problems.push(`${routeKey(route)} is served and not documented`);
      continue;
    }
    if (row.access.join(', ') !== route.access.join(', ')) {
      problems.push(
        `${routeKey(route)} needs ${route.access.join(', ')}, the document says ${row.access.join(', ')}`,
      );
    }
    if (row.closedBy !== route.closedBy) {
      problems.push(
        `${routeKey(route)} is closed by ${route.closedBy}, the document says ${row.closedBy}`,
      );
    }
  }
  for (const key of rows.keys()) {
    if (!served.has(key)) problems.push(`${key} is documented and not served`);
  }
  return problems;
}

function controllerFiles(directory) {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith(CONTROLLER_SUFFIX) ? [path] : [];
  });
}

const SETTINGS = {
  permissions: { 'USER_PERMISSIONS.READ_ALL': 'users:read:all' },
  bootstrap: { prefix: 'api', exclude: ['health'] },
};
const route = (method, path, access = [ACCESS.SIGNED_IN], closedBy = null) => ({
  method,
  path,
  access,
  closedBy,
});

test('a controller route carries the global prefix, its guard and its switch', () => {
  const source = `
    @Controller('auth/2fa')
    @RequiresFeature(AuthFeature.TWO_FACTOR)
    export class TwoFactorController {
      @Post('setup') setup() {}
      @Public() @Post('verify') verify() {}
      helper() {}
    }
    @Controller('admin/users')
    export class AdminUsersController {
      @Get() list() {}
      @Get(':id') @RequirePermissions(USER_PERMISSIONS.READ_ALL) read() {}
      @Post('password') @RequiresFeature(AuthFeature.PASSWORD) change() {}
    }
    export class NotAController { @Get('hidden') hidden() {} }`;
  assert.deepEqual(controllerRoutes('sample.controller.ts', source, SETTINGS), [
    route('POST', '/api/auth/2fa/setup', ['Signed in'], 'TWO_FACTOR_ENABLED'),
    route('POST', '/api/auth/2fa/verify', ['Public'], 'TWO_FACTOR_ENABLED'),
    route('GET', '/api/admin/users'),
    route('GET', '/api/admin/users/:id', ['users:read:all']),
    route('POST', '/api/admin/users/password', ['Signed in'], 'AUTH_PASSWORD_ENABLED'),
  ]);
});

test('a controller the prefix excludes keeps its own path', () => {
  const source = `@Controller('health') export class HealthController { @Public() @Get() read() {} }`;
  assert.deepEqual(controllerRoutes('health.controller.ts', source, SETTINGS), [
    route('GET', '/health', ['Public']),
  ]);
});

test('a permission or a feature the check cannot name stops the run', () => {
  const guarded = `@Controller('x') export class X { @Get() @RequirePermissions(USER_PERMISSIONS.GONE) read() {} }`;
  assert.throws(
    () => controllerRoutes('x.controller.ts', guarded, SETTINGS),
    /unknown permission USER_PERMISSIONS\.GONE/,
  );
  const switched = `@Controller('x') @RequiresFeature(AuthFeature.SMS) export class X { @Get() read() {} }`;
  assert.throws(
    () => controllerRoutes('x.controller.ts', switched, SETTINGS),
    /no setting is known for feature SMS/,
  );
  const computed = `@Controller(PREFIX) export class X { @Get() read() {} }`;
  assert.throws(
    () => controllerRoutes('x.controller.ts', computed, SETTINGS),
    /a path this check cannot read/,
  );
});

test('the permission constants and the global prefix are read from source text', () => {
  const constants = `export const USER_PERMISSIONS = { READ_ALL: 'users:read:all', LIST_ALL: 'users:list:all' } as const;
    export const WILDCARD_PERMISSION = '*' as const;`;
  assert.deepEqual(permissionConstants(constants), {
    'USER_PERMISSIONS.READ_ALL': 'users:read:all',
    'USER_PERMISSIONS.LIST_ALL': 'users:list:all',
  });
  assert.deepEqual(globalPrefix(`app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });`), {
    prefix: 'api',
    exclude: ['health', 'ready'],
  });
  assert.throws(() => globalPrefix('app.listen(3000);'), /global prefix call was not found/);
});

test('route rows are read from any table, with or without a marker cell', () => {
  const markdown = [
    '| Method | Path | Who may call it | Closed by | What it does |',
    '| ------ | ---- | --------------- | --------- | ------------ |',
    '| GET | `/api/auth/methods` | Public | | Lists the methods |',
    '| POST | `/api/auth/2fa/setup` | Signed in | `TWO_FACTOR_ENABLED` | Starts setup | <!-- feature:totp --> |',
    '| GET | `/api/admin/users/:id` | `users:read:all` | | Reads one account |',
    '',
    '| Setting | Default |',
    '| `PORT` | `3000` |',
  ].join('\n');
  assert.deepEqual(documentedRoutes(markdown), [
    route('GET', '/api/auth/methods', ['Public']),
    route('POST', '/api/auth/2fa/setup', ['Signed in'], 'TWO_FACTOR_ENABLED'),
    route('GET', '/api/admin/users/:id', ['users:read:all']),
  ]);
  assert.deepEqual(documentedRoutes('No table here.'), []);
});

test('matching routes and rows report nothing, and two empty lists report nothing', () => {
  const routes = [
    route('GET', '/api/roles', ['roles:list:all']),
    route('POST', '/api/auth/login', ['Public'], 'AUTH_PASSWORD_ENABLED'),
  ];
  assert.deepEqual(routeTableProblems(routes, [...routes].reverse()), []);
  assert.deepEqual(routeTableProblems([], []), []);
});

test('a route missing on either side is named, and so is another method on the same path', () => {
  assert.deepEqual(
    routeTableProblems(
      [route('POST', '/api/auth/resend-activation')],
      [route('POST', '/api/auth/resend-code')],
    ),
    [
      'POST /api/auth/resend-activation is served and not documented',
      'POST /api/auth/resend-code is documented and not served',
    ],
  );
  assert.deepEqual(
    routeTableProblems(
      [route('PATCH', '/api/roles/:idOrSlug')],
      [route('PUT', '/api/roles/:idOrSlug')],
    ),
    [
      'PATCH /api/roles/:idOrSlug is served and not documented',
      'PUT /api/roles/:idOrSlug is documented and not served',
    ],
  );
  assert.deepEqual(routeTableProblems([route('GET', '/health', ['Public'])], []), [
    'GET /health is served and not documented',
  ]);
});

test('a wrong guard, a wrong switch and a repeated row are named', () => {
  const coded = [route('POST', '/api/user/password', ['Signed in'], 'AUTH_PASSWORD_ENABLED')];
  assert.deepEqual(
    routeTableProblems(coded, [
      route('POST', '/api/user/password', ['Public'], 'AUTH_PASSWORD_ENABLED'),
    ]),
    ['POST /api/user/password needs Signed in, the document says Public'],
  );
  assert.deepEqual(routeTableProblems(coded, [route('POST', '/api/user/password')]), [
    'POST /api/user/password is closed by AUTH_PASSWORD_ENABLED, the document says null',
  ]);
  assert.deepEqual(
    routeTableProblems(
      [route('GET', '/api/roles', ['roles:list:all'])],
      [route('GET', '/api/roles', ['roles:read:all'])],
    ),
    ['GET /api/roles needs roles:list:all, the document says roles:read:all'],
  );
  assert.deepEqual(routeTableProblems(coded, [...coded, ...coded]), [
    'POST /api/user/password is documented twice',
  ]);
});

test('the documented routes are the routes the controllers serve', () => {
  const settings = {
    permissions: permissionConstants(read(PERMISSIONS_FILE)),
    bootstrap: globalPrefix(read(BOOTSTRAP_FILE), read(HTTP_ROUTES_FILE)),
  };
  const coded = controllerFiles(BACKEND_SOURCE).flatMap((file) =>
    controllerRoutes(file, read(file), settings),
  );
  assert.ok(
    coded.some((entry) => routeKey(entry) === 'POST /api/auth/login'),
    'the controllers were not read',
  );
  assert.deepEqual(routeTableProblems(coded, documentedRoutes(read(ROUTES_DOC))), []);
});
