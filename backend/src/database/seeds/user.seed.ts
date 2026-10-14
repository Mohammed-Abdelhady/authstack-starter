import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_ROLE_PERMISSIONS } from '../../common/constants/permissions';
import { HOST_ROLES } from '../../host/access';
import { HostRole } from '../../host/types/host-role.type';

export interface SeedUser {
  email: string;
  password: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface SeedUserDefinition {
  email: string;
  name: string;
  role: string;
  permissions: readonly string[];
}

/**
 * One seed account per system role: `user`, each host role, then `admin`.
 *
 * @param hostRoles - The host product's roles
 */
export function seedUserDefinitions(
  hostRoles: readonly HostRole[],
): SeedUserDefinition[] {
  return [
    {
      email: 'user@seed.local',
      name: 'Seed User',
      role: 'user',
      permissions: DEFAULT_ROLE_PERMISSIONS.user,
    },
    ...hostRoles.map((role) => ({
      email: `${role.slug}@seed.local`,
      name: `Seed ${role.name}`,
      role: role.slug,
      permissions: role.permissions,
    })),
    {
      email: 'admin@seed.local',
      name: 'Seed Admin',
      role: 'admin',
      permissions: DEFAULT_ROLE_PERMISSIONS.admin,
    },
  ];
}

export const SEED_USER_DEFINITIONS: SeedUserDefinition[] =
  seedUserDefinitions(HOST_ROLES);

export function generateSeedPassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

export function getSeedUsers(): SeedUser[] {
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD || generateSeedPassword();
  const userPassword = process.env.SEED_USER_PASSWORD || generateSeedPassword();

  return SEED_USER_DEFINITIONS.map((def) => {
    let password: string;
    if (def.role === 'admin') {
      password = adminPassword;
    } else if (def.role === 'user') {
      password = userPassword;
    } else {
      password = generateSeedPassword();
    }

    return {
      email: def.email,
      password,
      name: def.name,
      role: def.role,
      permissions: [...def.permissions],
    };
  });
}

export function printSeedCredentials(users: SeedUser[]): void {
  const border = '='.repeat(72);
  const divider = '-'.repeat(72);

  console.log('\n' + border);
  console.log('SEED USER ACCOUNTS');
  console.log(border);
  console.log('Role'.padEnd(12) + 'Email');
  console.log(divider);

  for (const user of users) {
    console.log(user.role.padEnd(12) + user.email);
  }

  console.log(border);

  if (process.env.SEED_PRINT_PASSWORDS !== 'true') {
    console.log(
      'Passwords are omitted. Set SEED_PRINT_PASSWORDS=true to write them to an owner-only file.\n',
    );
    return;
  }

  const filePath = path.resolve(
    process.cwd(),
    process.env.SEED_PASSWORD_FILE ?? '.seed-passwords',
  );
  const lines = [
    'SEED USER PASSWORDS',
    divider,
    ...users.map(
      (user) =>
        `${user.role.padEnd(12)}${user.email.padEnd(28)}${user.password}`,
    ),
    '',
  ];
  fs.writeFileSync(filePath, lines.join('\n'), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(filePath, 0o600);
  console.log(`Passwords written to ${filePath}\n`);
}

export const SEED_USERS: SeedUser[] = getSeedUsers();

export const SEED_EMAILS: string[] = SEED_USER_DEFINITIONS.map(
  (user) => user.email,
);
