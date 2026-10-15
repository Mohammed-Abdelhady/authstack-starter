import type {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../common/persistence/unit-of-work';
import { partialMock } from '../common/testing/test-doubles.harness-spec';
import type { SessionRevoker } from '../session/revocation/session-revoker';
import type { AudienceMappingStore } from '../user/stores/audience-mapping.store';
import type { AudienceMappingSnapshot } from '../user/types/audience-mapping';
import { AudienceApplyService } from './audience-apply.service';

const SNAPSHOT: AudienceMappingSnapshot = {
  roles: [
    { id: 'role-user', slug: 'user', permissions: [] },
    { id: 'role-admin', slug: 'admin', permissions: ['*'] },
  ],
  accounts: [
    { id: 'account-1', role: 'user', permissions: [] },
    { id: 'account-2', role: 'admin', permissions: [] },
    { id: 'account-3', role: 'user', permissions: [] },
  ],
};

/** Each unit of work commits its writes when it returns, and drops them when it throws. */
function command(failingAccount?: string) {
  const committed: string[][] = [];
  let pending: string[] = [];
  const units = new Map<UnitOfWork, number>();
  const runner = partialMock<UnitOfWorkRunner>({
    run: async (work) => {
      const unit = partialMock<UnitOfWork>();
      units.set(unit, units.size + 1);
      pending = [];
      const result = await work(unit);
      committed.push(pending);
      return result;
    },
  });
  const write = (work: UnitOfWork, entry: string): void => {
    pending.push(`${units.get(work)}:${entry}`);
  };
  const store = partialMock<AudienceMappingStore>({
    snapshot: () => Promise.resolve(SNAPSHOT),
    mapRole: (work, role, audience) => {
      write(work, `role ${role.slug}=${audience}`);
      return Promise.resolve();
    },
    mapAccount: (work, account, audience) => {
      if (account.id === failingAccount) {
        return Promise.reject(new Error('Account changed role'));
      }
      write(work, `account ${account.id}=${audience}`);
      return Promise.resolve();
    },
  });
  const revoker = partialMock<SessionRevoker>({
    revokeAllForUserIn: (work, userId) => {
      write(work, `sessions ${userId} ended`);
      return Promise.resolve(1);
    },
  });
  return {
    service: new AudienceApplyService(runner, store, revoker),
    committed,
  };
}

// Failure: one transaction holds every account, so a large installation passes
// the database's transaction lifetime and can never finish the mapping.
describe('audience apply', () => {
  it('maps roles first, then each account with its session end in its own unit of work', async () => {
    const { service, committed } = command();

    const summary = await service.apply({ dryRun: false, roles: new Map() });

    expect({ summary, committed }).toEqual({
      summary: { dryRun: false, roles: 2, accounts: 3, revokedSessions: 3 },
      committed: [
        ['1:role user=customer', '1:role admin=staff'],
        ['2:account account-1=customer', '2:sessions account-1 ended'],
        ['3:account account-2=staff', '3:sessions account-2 ended'],
        ['4:account account-3=customer', '4:sessions account-3 ended'],
      ],
    });
  });

  it('keeps accounts mapped before a failure and stops at the failing one', async () => {
    const { service, committed } = command('account-2');

    await expect(
      service.apply({ dryRun: false, roles: new Map() }),
    ).rejects.toThrow('Account changed role');

    expect(committed).toEqual([
      ['1:role user=customer', '1:role admin=staff'],
      ['2:account account-1=customer', '2:sessions account-1 ended'],
    ]);
  });
});
