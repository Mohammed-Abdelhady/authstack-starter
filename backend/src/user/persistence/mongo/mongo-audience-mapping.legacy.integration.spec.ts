import { Types } from 'mongoose';
import { audienceMappingPlan } from '../../../cli/utils/audience-mapping-plan';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import {
  Role,
  RoleDocument,
} from '../../../role/persistence/mongo/schemas/role.schema';
import { MongoAudienceMappingStore } from './mongo-audience-mapping.store';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  type SessionAuthorityHarness,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';

describe('audience inventory of legacy MongoDB documents', () => {
  let mongo: MemoryReplSet;
  let authority: SessionAuthorityHarness;
  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    authority = await bootSessionAuthority(
      mongo.uri('audience_legacy'),
      new FrozenClock(TEST_NOW),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await authority?.app.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // Failure: lean reads bypass defaults and stop migration on legacy missing grants.
  it('plans customer mapping for legacy roles and accounts without permissions', async () => {
    const roles = authority.connection.model<RoleDocument>(Role.name);
    const userId = new Types.ObjectId();
    await roles.collection.insertOne({ slug: 'user', name: 'User' });
    await authority.users.collection.insertOne({
      _id: userId,
      role: 'user',
      email: 'legacy-audience@example.test',
      name: 'Legacy Customer',
    });
    const store = new MongoAudienceMappingStore(authority.users, roles);
    const snapshot = await authority.app
      .get(UnitOfWorkRunner)
      .run((work) => store.snapshot(work));
    expect(snapshot.roles).toMatchObject([{ slug: 'user', permissions: [] }]);
    expect(snapshot.accounts).toMatchObject([
      { role: 'user', permissions: [] },
    ]);
    const plan = audienceMappingPlan(snapshot, new Map());
    expect(plan.roles.map(({ audience }) => audience)).toEqual(['customer']);
    expect(plan.accounts.map(({ audience }) => audience)).toEqual(['customer']);
  });
});
