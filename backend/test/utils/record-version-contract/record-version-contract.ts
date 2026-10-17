import { RecordVersionHarness } from './record-version-harness';

export function describeRecordVersionContract(
  database: string,
  boot: () => Promise<RecordVersionHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`record version contract on ${database}`, () => {
    let harness: RecordVersionHarness | undefined;
    const current = (): RecordVersionHarness => {
      if (!harness) throw new Error('record version harness did not start');
      return harness;
    };
    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);
    afterAll(async () => {
      await harness?.close();
    }, budgets.teardownMs);
    beforeEach(async () => {
      await current().reset();
    }, budgets.resetMs);

    it('prevents a staff edit from leaving a stale account version valid', async () => {
      const h = current();
      const { accountId } = await h.seed();
      expect(await h.accountVersion(accountId)).toBe(0);
      await h.editAccount(accountId);
      expect(await h.accountVersion(accountId)).toBe(1);
    });

    it('prevents session bookkeeping from invalidating staff edits', async () => {
      const h = current();
      const { accountId } = await h.seed();
      await h.editAccount(accountId);
      await h.editBookkeeping(accountId);
      expect(await h.accountVersion(accountId)).toBe(1);
    });

    it('invalidates stale role edits after permissions change', async () => {
      const h = current();
      const { roleId } = await h.seed();
      expect(await h.roleVersion(roleId)).toBe(0);
      await h.editRole(roleId);
      expect(await h.roleVersion(roleId)).toBe(1);
    });

    // feature:mongodb:start
    if (database === 'MongoDB')
      it('prevents Mongo document and query writes from bypassing version checks', async () => {
        const h = current();
        const { accountId, roleId } = await h.seed();
        if (!h.mongoWrites)
          throw new Error('Mongo version write cases missing');
        await h.mongoWrites(accountId, roleId);
      });
    // feature:mongodb:end
  });
}
