/** Words a PostgreSQL project has no use for, the names of MongoDB collections included. */
export const MONGO_WORDS = [
  /mongo/i,
  /replica set/i,
  /replset/i,
  /objectid/i,
  /\bcollections?\b/i,
  /TTL index/i,
  /27017/,
  /findOneAndUpdate/,
  /subdocument/i,
  /\$lookup/,
  /\.aggregate\(/,
  /\bdb\.[a-z]+\./,
  /pendingmagiclinks|twofactorchallenges|passkeychallenges|pendingregistrations|pendingpasswordresets|mailcounters/,
];

/**
 * Every line of a PostgreSQL project with every method that still matches one
 * of those words, by file. Each is there for a reason, and a new line in any
 * of these files, or a new file, fails the case that reads this.
 *
 * The filter reads two failure shapes without loading a driver, and its specs
 * build those shapes by hand. The rest use the word for something else: a
 * request collection, a schematics collection, a collection of validation
 * schemas, a statement that PostgreSQL has no such index.
 */
export const MONGO_SURVIVING_LINES: Record<string, string[]> = {
  'backend/README.md': ['- [Postman collection](docs/postman/README.md)'],
  'backend/docs/postman/FULL-MERN-AUTH-Boilerplate-API.postman_collection.json': [
    '"description": "API collection for NestJS backend with cookie sessions, dynamic RBAC, TOTP 2FA, passkeys, and OAuth.",',
    '"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",',
  ],
  'backend/docs/postman/README.md': [
    '# Postman collection',
    'This directory contains the Postman collection and environment files for testing backend endpoints.',
    '- `FULL-MERN-AUTH-Boilerplate-API.postman_collection.json`: Complete collection of backend requests organized by domain.',
    '### 1. Import collection',
    '## Collection structure',
    'The collection contains the following folders:',
  ],
  'backend/nest-cli.json': ['"collection": "@nestjs/schematics",'],
  'backend/src/common/constants/mongo-errors.ts': [
    'export const MONGO_DUPLICATE_KEY_CODE = 11000;',
  ],
  'backend/src/common/filters/global-exception.filter.driver-logs.spec.ts': [
    "name: 'MongoServerError',",
    '\'E11000 duplicate key error collection: users index: email dup key: { email: "secret@example.com" }\',',
    '\'Cast to ObjectId failed for value "not-an-id\\\'" (type string) at path "_id"\',',
    "name: 'MongoServerError',",
    "name: 'MongoServerError',",
    "name: 'MongoServerError',",
  ],
  'backend/src/common/filters/global-exception.filter.sql.spec.ts': [
    '/** What MongoDB raises for a refused unique rule, by shape. */',
    "name: 'MongoServerError',",
    "* error. These are the answers for the SQL ones, next to the answers MongoDB's",
    "it('answers a taken address as it answers the MongoDB duplicate key', () => {",
    "mongo: answerTo(duplicateKey('email', ADDRESS)),",
    '}).toEqual({ sql: taken, mongo: taken });',
    "it('answers any other refused unique rule as a conflict, like MongoDB', () => {",
    "mongo: answerTo(duplicateKey('slug', 'editor')),",
    '}).toEqual({ sql: conflict, unnamed: conflict, mongo: conflict });',
    "])('answers %s as an unexpected error, as it does for MongoDB', (_, code) => {",
  ],
  'backend/src/common/persistence/postgres/migrations/0003_pending_codes.sql': [
    '-- PostgreSQL has no TTL index. A row stays after it expires until a',
  ],
  'backend/src/common/persistence/postgres/migrations/0004_browser_proofs_security_events.sql': [
    "-- PostgreSQL has no TTL index. The store's delete-expired statement reads this.",
  ],
  'backend/src/common/persistence/postgres/migrations/0012_retention_indexes.sql': [
    '-- PostgreSQL has no TTL index. The retention job removes rows past their',
  ],
  'backend/src/common/persistence/postgres/migrations/0013_magic_links.sql': [
    '-- none. PostgreSQL has no TTL index, so a row stays after it expires until the',
  ],
  'backend/src/common/utils/driver-error-shape.util.ts': [
    "import { MONGO_DUPLICATE_KEY_CODE } from '../constants/mongo-errors';",
    'exception.code === MONGO_DUPLICATE_KEY_CODE',
  ],
  'backend/test/utils/e2e-storage.ts': [
    "* and never a collection or a table. What more than one area's cases need is",
  ],
  'docs/README.md': [
    '- [Postman collection](../backend/docs/postman/README.md): Postman collection, environments, and test scripts.',
  ],
  'docs/setup/setup-facebook-oauth-publishing-and-configuration.md': [
    '2. **User Consent**: Clear opt-in for data collection',
  ],
  'shared/core/src/validations/array/index.ts': [
    '* Collection of array validation schemas. Every message comes from the caller',
  ],
  'shared/core/src/validations/boolean/index.ts': [
    '* Collection of boolean validation schemas. Every message comes from the caller',
  ],
  'shared/core/src/validations/date/index.ts': [
    '* Collection of date and time validation schemas. Every message comes from the',
  ],
  'shared/core/src/validations/number/index.ts': [
    '* Collection of number validation schemas. Every message comes from the caller',
  ],
  'shared/core/src/validations/object/index.ts': ['* Collection of object validation schemas.'],
  'shared/core/src/validations/special/index.ts': [
    '* Collection of special-purpose validation schemas (enum, union, literal, etc.).',
  ],
};
