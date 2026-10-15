const UNFOLLOWED_MODEL_FIXTURES = [
  {
    kind: 'MongoDB bound create method',
    source: `function makeAccount(model: Model<UserDocument>) {
      const make = model.create.bind(model); make(data);
    }`,
    diagnostic: 'insert method requires a direct call',
  },
  ...['create', 'insertMany', 'insertOne', 'bulkWrite', 'updateOne'].flatMap(
    (method) => [
      {
        kind: `MongoDB ${method} call reference`,
        source: `this.userModel.${method}.call(this.userModel, data)`,
        diagnostic: 'insert method requires a direct call',
      },
      {
        kind: `MongoDB ${method} apply reference`,
        source: `this.userModel.${method}.apply(this.userModel, [data])`,
        diagnostic: 'insert method requires a direct call',
      },
      {
        kind: `MongoDB ${method} destructuring`,
        source: `const { ${method}: make } = this.userModel; make(data)`,
        diagnostic: 'insert method requires a direct call',
      },
    ],
  ),
  {
    kind: 'MongoDB assigned create method',
    source: 'const make = this.userModel.create; make(data)',
    diagnostic: 'insert method requires a direct call',
  },
  {
    kind: 'MongoDB passed create method',
    source: 'consume(this.userModel.create)',
    diagnostic: 'insert method requires a direct call',
  },
  {
    kind: 'MongoDB computed create reference',
    source: "const m = 'create'; this.userModel[m].bind(this.userModel)",
    diagnostic: 'insert method requires a direct call',
  },
  {
    kind: 'MongoDB computed create destructuring',
    source: "const m = 'create'; const { [m]: make } = this.userModel",
    diagnostic: 'insert method requires a direct call',
  },
  {
    kind: 'MongoDB bound new document save',
    source: 'const user = new this.userModel({}); user.save.bind(user)',
    diagnostic: 'insert method requires a direct call',
  },
  {
    kind: 'MongoDB model alias',
    source: 'const M = this.userModel; M.create({})',
    diagnostic: 'unfollowed user-model alias',
  },
  {
    kind: 'MongoDB bulkWrite model alias',
    source:
      'const M = this.userModel; M.bulkWrite([{ insertOne: { document: {} } }])',
    diagnostic: 'unfollowed user-model alias',
  },
  {
    kind: 'MongoDB element model alias',
    source: "const M = this['userModel']; M.create({})",
    diagnostic: 'unfollowed user-model alias',
  },
  {
    kind: 'MongoDB assigned model alias',
    source: 'let M; M = this.userModel; M.insertMany([{}])',
    diagnostic: 'unfollowed user-model alias',
  },
  {
    kind: 'MongoDB destructured model alias',
    source: 'const { userModel: M } = this; M.create({})',
    diagnostic: 'unfollowed user-model alias',
  },
  ...['create', 'insertMany', 'bulkWrite'].map((method) => ({
    kind: `MongoDB unresolved ${method} receiver`,
    source: `unknownModel.${method}([])`,
    diagnostic: 'unresolved user-model write receiver',
  })),
  {
    kind: 'MongoDB bare create receiver',
    source: 'create({})',
    diagnostic: 'unresolved user-model write receiver',
  },
  {
    kind: 'MongoDB local alias sharing another model property name',
    source: 'const roleModel = getModel(); roleModel.create({})',
    diagnostic: 'unresolved user-model write receiver',
  },
  ...['unknown', ''].map((type) => ({
    kind: `MongoDB opaque model type: ${type || 'bare Model'}`,
    source: `function opaque(model: Model${type ? `<${type}>` : ''}) { model.create({}); }`,
    diagnostic: 'unresolved user-model write receiver',
  })),
] as const;

export const MONGO_UNFOLLOWED_RAW_FIXTURES = UNFOLLOWED_MODEL_FIXTURES.map(
  (fixture) => ({
    ...fixture,
    source: `class Bypass {
      constructor(
        private userModel: Model<UserDocument>,
        private roleModel: Model<RoleDocument>,
      ) {}
      async bypass() { ${fixture.source}; }
    }`,
  }),
);

export const MONGO_RAW_INSERT_FIXTURES = [
  ['MongoDB create', 'this.userModel.create({})', 'create'],
  ['MongoDB computed create', "this.userModel['create']({})", 'create'],
  [
    'MongoDB resolved create method',
    "(() => { const m = 'create'; return this.userModel[m]({}); })()",
    'create',
  ],
  ['MongoDB insertMany', 'this.userModel.insertMany([{}])', 'insertMany'],
  [
    'MongoDB bulkWrite insertOne',
    'this.userModel.bulkWrite([{ insertOne: { document: {} } }])',
    'bulkWrite',
  ],
  [
    'MongoDB collection insertOne',
    'this.userModel.collection.insertOne({})',
    'insertOne',
  ],
  ['MongoDB new and save', 'new this.userModel({}); await user.save()', 'save'],
  ...[
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
  ].map(
    (method) =>
      [
        `MongoDB ${method} upsert`,
        `this.userModel.${method}({}, {}, { upsert: true })`,
        method,
      ] as const,
  ),
  [
    'MongoDB unresolved upsert options',
    'this.userModel.updateOne({}, {}, options)',
    'updateOne',
  ],
  [
    'MongoDB mutated options variable',
    `(() => {
      const options = { upsert: false }; options.upsert = true;
      return this.userModel.updateOne({}, {}, options);
    })()`,
    'updateOne',
  ],
  [
    'MongoDB spread upsert options',
    'this.userModel.updateOne({}, {}, { ...base })',
    'updateOne',
  ],
  [
    'MongoDB variable upsert flag',
    `(() => {
      const flag = false;
      return this.userModel.updateOne({}, {}, { upsert: flag });
    })()`,
    'updateOne',
  ],
  ...[
    'optionsFactory()',
    'settings.options',
    '{ upsert }',
    "{ ['upsert']: false }",
    "{ ['session']: session }",
  ].map(
    (options) =>
      [
        `MongoDB opaque upsert options: ${options}`,
        `this.userModel.updateOne({}, {}, ${options})`,
        'updateOne',
      ] as const,
  ),
  ...[
    'function other() { const flag = false; }',
    'function other(flag) { return flag; }',
    'function other() { let flag = false; }',
  ].map(
    (shadow) =>
      [
        `MongoDB shadowed upsert flag: ${shadow}`,
        `(() => { const flag = true; ${shadow} return this.userModel.updateOne({}, {}, { upsert: flag }); })()`,
        'updateOne',
      ] as const,
  ),
] as const;
