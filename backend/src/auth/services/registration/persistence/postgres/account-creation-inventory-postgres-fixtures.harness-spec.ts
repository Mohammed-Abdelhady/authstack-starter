export const POSTGRES_UNFOLLOWED_RAW_FIXTURES = [
  {
    kind: 'PostgreSQL bound insertInto method',
    source:
      "const insert = database.insertInto.bind(database); insert('users')",
    diagnostic: 'insert method requires a direct call',
  },
  ...[
    "database.insertInto.call(database, 'users')",
    "database.insertInto.apply(database, ['users'])",
    'const insert = database.insertInto',
    'consume(database.insertInto)',
    'const { insertInto } = database',
    'const { insertInto: insert } = database',
    "database['insertInto'].bind(database)",
    "const m = 'insertInto'; database[m].bind(database)",
    "const m = 'insertInto'; const { [m]: insert } = database",
  ].map((source) => ({
    kind: `PostgreSQL insertInto reference: ${source}`,
    source,
    diagnostic: 'insert method requires a direct call',
  })),
  {
    kind: 'PostgreSQL variable table',
    source: "const t = 'users' as const; db.insertInto(t)",
    diagnostic: 'unresolved insertInto table',
  },
  {
    kind: 'PostgreSQL computed table',
    source: 'db.insertInto(tableName())',
    diagnostic: 'unresolved insertInto table',
  },
] as const;

export const POSTGRES_RAW_INSERT_FIXTURES = [
  ['PostgreSQL', "database.insertInto('users').values({})", 'postgres'],
  [
    'PostgreSQL resolved insertInto method',
    "(() => { const m = 'insertInto'; return database[m]('users'); })()",
    'postgres',
  ],
  [
    'PostgreSQL onConflict upsert',
    "database.insertInto('users').values({}).onConflict(c => c.column('email').doUpdateSet({}))",
    'postgres',
  ],
] as const;
