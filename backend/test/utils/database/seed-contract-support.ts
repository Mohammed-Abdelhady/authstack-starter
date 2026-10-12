import { ConfigService } from '@nestjs/config';
import { RoleSeedService } from '../../../src/database/seeds/role.seed';
import { SeedService } from '../../../src/database/seeds/seed.service';
import { SeedContractHarness, StoredSeedRole } from './seed-contract-harness';

export const ADMIN_PASSWORD = 'SeedAdmin123!';
export const USER_PASSWORD = 'SeedUser123!';
/** What the role seed prints, apart from the table of seed accounts. */
export const ROLE_LINE =
  /^(?:Created default role: |Role "|Role seeding completed)/;
const OWN_PROFILE = ['profile:read:own', 'profile:update:own'];

/** The four system roles as a seed stores them, written out by hand. */
export const SEEDED_ROLES: StoredSeedRole[] = [
  {
    name: 'Admin',
    slug: 'admin',
    description: 'System administrator with full access',
    isSystemRole: true,
    isProtected: true,
    level: 4,
    permissions: ['*'],
  },
  {
    name: 'Manager',
    slug: 'manager',
    description: 'Management staff',
    isSystemRole: true,
    isProtected: true,
    level: 3,
    permissions: [
      ...OWN_PROFILE,
      'users:read:all',
      'users:update:all',
      'sessions:read:all',
      'roles:read:all',
    ],
  },
  {
    name: 'Support',
    slug: 'support',
    description: 'Customer support staff',
    isSystemRole: true,
    isProtected: true,
    level: 2,
    permissions: [...OWN_PROFILE, 'users:read:all', 'sessions:read:all'],
  },
  {
    name: 'User',
    slug: 'user',
    description: 'Default role for all customers',
    isSystemRole: true,
    isProtected: true,
    level: 1,
    permissions: OWN_PROFILE,
  },
];

export const SEEDED_ACCOUNTS = [
  { email: 'admin@seed.local', name: 'Seed Admin', role: 'admin' },
  { email: 'manager@seed.local', name: 'Seed Manager', role: 'manager' },
  { email: 'support@seed.local', name: 'Seed Support', role: 'support' },
  { email: 'user@seed.local', name: 'Seed User', role: 'user' },
];

export function servicesOn(harness: SeedContractHarness): {
  seeds: SeedService;
  roles: RoleSeedService;
} {
  const roles = new RoleSeedService(harness.seeds);
  return {
    roles,
    seeds: new SeedService(
      harness.seeds,
      new ConfigService({ bcrypt: { rounds: 4 } }),
      roles,
      harness.registry,
    ),
  };
}

/** What the accounts look like, leaving out ids and hashes. */
export async function accountFacts(harness: SeedContractHarness) {
  return (await harness.storedAccounts()).map(
    ({ email, name, role, isVerified, isDeleted, authProvider }) => ({
      email,
      name,
      role,
      isVerified,
      isDeleted,
      authProvider,
    }),
  );
}
