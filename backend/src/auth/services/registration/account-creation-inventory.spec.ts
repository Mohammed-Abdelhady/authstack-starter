import {
  replaceInventoryCall,
  moveInventoryPolicyToEnd,
  scanAccountCreation,
} from './account-creation-inventory-ast.harness-spec';
import {
  expectedInventory,
  SEED_BOOTSTRAP_EXEMPTION,
} from './account-creation-inventory-expectations.harness-spec';
import {
  appendInventoryFixture,
  RAW_INSERT_FIXTURES,
  readInventoryDocuments,
  UNFOLLOWED_INSERT_FIXTURES,
  UNFOLLOWED_RAW_FIXTURES,
  withoutInventoryFeatures,
} from './account-creation-inventory-fixtures.harness-spec';
import { withoutInventoryDatabase } from './account-creation-inventory-databases.harness-spec'; // feature:database-choice

describe('account creation inventory', () => {
  const documents = readInventoryDocuments();
  const creators = expectedInventory(new Set(documents.keys())).callers.filter(
    (entry) => entry.boundary !== 'seed',
  );

  it('covers every creator and raw account insert in the source tree', () => {
    expect(scanAccountCreation(documents).errors).toEqual([]);
  });

  it('names the deployment bootstrap exemption', () => {
    const inventory = scanAccountCreation(documents);
    expect(inventory.callers).toContain(SEED_BOOTSTRAP_EXEMPTION);
    expect(inventory.errors).toEqual([]);
  });

  it.each(creators)('rejects removed policy in $file', ({ file }) => {
    const mutated = replaceInventoryCall(
      documents,
      file,
      'assertMayCreate',
      () => 'Promise.resolve()',
    );
    expect(scanAccountCreation(mutated).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('earlier awaited policy'),
      ]),
    );
  });

  it.each(creators)(
    'rejects policy on a different UOW in $file',
    ({ file }) => {
      const mutated = replaceInventoryCall(
        documents,
        file,
        'assertMayCreate',
        (call) => call.replace(/unitOfWork(?=\s*,?\s*\))/, 'otherUnitOfWork'),
      );
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([expect.stringContaining('insert UOW')]),
      );
    },
  );

  it.each(creators)(
    'rejects policy hidden in a callback in $file',
    ({ file }) => {
      const mutated = replaceInventoryCall(
        documents,
        file,
        'assertMayCreate',
        (call) => `Promise.resolve(async () => ${call})`,
      );
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('earlier awaited policy'),
        ]),
      );
    },
  );

  it.each(creators)('rejects policy after creation in $file', ({ file }) => {
    const mutated = moveInventoryPolicyToEnd(documents, file);
    expect(scanAccountCreation(mutated).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('earlier awaited policy'),
      ]),
    );
  });

  it.each(creators.filter((entry) => entry.boundary !== 'parameter'))(
    'rejects creation outside the transaction runner in $file',
    ({ file, boundary }) => {
      const mutated = replaceInventoryCall(documents, file, boundary, (call) =>
        call.replace(`runner.${boundary}`, 'runner.outsideTransaction'),
      );
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('runner callback UOW'),
        ]),
      );
    },
  );

  it.each(creators)(
    'rejects a missing creator in $file',
    ({ file, method }) => {
      const mutated = replaceInventoryCall(
        documents,
        file,
        method,
        () => 'Promise.resolve(null)',
      );
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([expect.stringContaining('callers: expected')]),
      );
    },
  );

  it.each(creators)(
    'accepts a direct element insert call in $file',
    ({ file, method }) => {
      const mutated = replaceInventoryCall(documents, file, method, (call) =>
        call.replace(`.${method}`, `['${method}']`),
      );
      expect(scanAccountCreation(mutated).errors).toEqual([]);
    },
  );

  it.each(creators)(
    'accepts a resolved constant insert call in $file',
    ({ file, method }) => {
      const mutated = replaceInventoryCall(documents, file, method, (call) =>
        call.replace(`.${method}`, '[INVENTORY_INSERT_METHOD]'),
      );
      const text = mutated.get(file);
      if (text === undefined) throw new Error(`Missing fixture source ${file}`);
      mutated.set(
        file,
        `const INVENTORY_INSERT_METHOD = '${method}';\n${text}`,
      );
      expect(scanAccountCreation(mutated).errors).toEqual([]);
    },
  );

  it('rejects an extra creator even when it checks the policy', () => {
    const mutated = appendInventoryFixture(
      documents,
      `async function ungated(unitOfWork) {
        await policy.assertMayCreate({}, unitOfWork);
        return store.insertActivated(unitOfWork, {});
      }`,
    );
    expect(scanAccountCreation(mutated).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('callers: expected')]),
    );
  });

  it.each(UNFOLLOWED_INSERT_FIXTURES)(
    'rejects an unfollowed account insert reference: %s',
    (_kind, reference) => {
      const mutated = appendInventoryFixture(documents, reference);
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('insert method requires a direct call'),
        ]),
      );
    },
  );

  it.each(UNFOLLOWED_RAW_FIXTURES)(
    'rejects an unfollowed raw insert: $kind',
    ({ source, diagnostic }) => {
      const mutated = appendInventoryFixture(documents, source);
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([expect.stringContaining(diagnostic)]),
      );
    },
  );

  it.each(RAW_INSERT_FIXTURES)(
    'rejects a raw %s account insert outside store methods',
    (_kind, insert, method) => {
      const mutated = appendInventoryFixture(
        documents,
        `class Bypass { async bypass() { const user = ${insert}; } }`,
      );
      const inventory = scanAccountCreation(mutated);
      expect(inventory.raw).toContain(
        `auth/services/registration/ungated-fixture.ts#bypass#${method}`,
      );
      expect(inventory.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('raw inserts: expected'),
        ]),
      );
    },
  );

  // feature:mongodb:start
  it('rejects a typed identifier model constructor and computed document save', () => {
    const mutated = appendInventoryFixture(
      documents,
      `class Bypass { async bypass(model: Model<UserDocument>) {
        const user = new model({});
        await user['save']();
      } }`,
    );
    const inventory = scanAccountCreation(mutated);
    expect(inventory.raw).toEqual(
      expect.arrayContaining([
        'auth/services/registration/ungated-fixture.ts#bypass#construct',
        'auth/services/registration/ungated-fixture.ts#bypass#save',
      ]),
    );
    expect(inventory.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('raw inserts: expected'),
      ]),
    );
  });

  it('does not classify an existing document save as account creation', () => {
    const mutated = appendInventoryFixture(
      documents,
      `class Update { async update() {
        const user = await this.userModel.findOne({});
        await user.save();
      } }`,
    );
    expect(scanAccountCreation(mutated).errors).toEqual([]);
  });

  it('allows non-inserting user updates and known other models in a user-model file', () => {
    const mutated = appendInventoryFixture(
      documents,
      `class Update {
        constructor(
          private userModel: Model<UserDocument>,
          private roleModel: Model<RoleDocument>,
        ) {}
        async update() {
          await this.userModel.updateOne({}, {});
          await this.userModel.updateOne({}, {}, {});
          await this.userModel.updateOne({}, {}, { session });
          await this.userModel.updateOne({}, {}, {
            session: mongoSessionOf(unitOfWork),
          });
          await this.userModel.updateOne({}, {}, { session, timestamps: false });
          await this.userModel.updateMany({}, {}, { upsert: false });
          await this.userModel.findOneAndReplace({}, {}, { 'upsert': false });
          await this.roleModel.create({});
        }
      }`,
    );
    expect(scanAccountCreation(mutated).errors).toEqual([]);
  });
  // feature:mongodb:end

  it('ignores insert and policy names in comments and strings', () => {
    const mutated = appendInventoryFixture(
      documents,
      `// store.insertActivated(unitOfWork, {});
      const example = "database.insertInto('users'); policy.assertMayCreate()";`,
    );
    expect(scanAccountCreation(mutated).errors).toEqual([]);
  });

  it('rejects a missing core source document', () => {
    const mutated = new Map(documents);
    mutated.delete('admin/services/users/admin-user-create.service.ts');
    expect(scanAccountCreation(mutated).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('callers: expected')]),
    );
  });

  it('rejects an empty tree', () => {
    expect(scanAccountCreation(new Map()).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('callers: expected')]),
    );
  });

  it.each([
    { features: ['magic-link'] as const },
    { features: ['email-password'] as const },
    { features: ['oauth-core'] as const },
    { features: ['magic-link', 'email-password', 'oauth-core'] as const },
  ])('accepts feature removal $features', ({ features }) => {
    const pruned = withoutInventoryFeatures(documents, features);
    expect(scanAccountCreation(pruned).errors).toEqual([]);
  });

  // feature:database-choice:start
  it.each([
    {
      removed: 'mongodb' as const,
      remaining: 'postgres',
      rawCount: 5,
      insert: "database.insertInto('users').values({})",
    },
    {
      removed: 'postgres' as const,
      remaining: 'mongo',
      rawCount: 7,
      insert: 'this.userModel.create({})',
    },
  ])(
    'accepts database removal $removed and retains insert coverage',
    ({ removed, remaining, rawCount, insert }) => {
      const pruned = withoutInventoryDatabase(documents, removed);
      const inventory = scanAccountCreation(pruned);
      expect(inventory.errors).toEqual([]);
      expect(inventory.callers).toHaveLength(6);
      expect(inventory.raw).toHaveLength(rawCount);
      expect(
        inventory.raw.every((entry) =>
          entry.includes(`/persistence/${remaining}/`),
        ),
      ).toBe(true);
      const mutated = appendInventoryFixture(
        pruned,
        `class Bypass { async bypass() { ${insert}; } }`,
      );
      expect(scanAccountCreation(mutated).errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('raw inserts: expected'),
        ]),
      );
    },
  );
  // feature:database-choice:end
});
