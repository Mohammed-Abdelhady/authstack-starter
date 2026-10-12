import { Injectable, Provider } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import { Model, Types } from 'mongoose';
import * as path from 'path';
import {
  Role,
  RoleDocument,
} from '../../../../role/persistence/mongo/schemas/role.schema';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import {
  assertResetAllowed,
  NewSeedAccount,
  ROLE_SEED,
  RoleSeedOutcome,
  SeedRole,
  SeedStore,
} from '../../seed.store';

const DEFAULT_CHANGELOG_COLLECTION = 'migrations';

/** The collection migrate-mongo records applied migrations in. */
function changelogCollectionName(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'migrate-mongo-config.js'),
    path.resolve(process.cwd(), 'backend/migrate-mongo-config.js'),
    path.resolve(__dirname, '../../../../../migrate-mongo-config.js'),
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const match = content.match(
          /changelogCollectionName:\s*['"]([^'"]+)['"]/,
        );
        if (match && match[1]) {
          return match[1];
        }
      } catch {
        // Fall back to next candidate path
      }
    }
  }

  return DEFAULT_CHANGELOG_COLLECTION;
}

/** A failure leaves as the driver raised it: the seed names it in its log. */
@Injectable()
export class MongoSeedStore extends SeedStore {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {
    super();
  }

  async seedRole(role: SeedRole): Promise<RoleSeedOutcome> {
    const exists = await this.roleModel.findOne({ slug: role.slug });

    if (!exists) {
      await this.roleModel.create(role);
      return ROLE_SEED.CREATED;
    }

    // Existing installs predate the level field and the protection flags
    await this.roleModel.updateOne(
      { slug: role.slug },
      {
        $set: {
          isSystemRole: role.isSystemRole,
          isProtected: role.isProtected,
          level: role.level,
        },
      },
    );
    return ROLE_SEED.REFRESHED;
  }

  async replaceRolePermissions(
    slug: string,
    permissions: string[],
  ): Promise<void> {
    await this.roleModel.updateOne({ slug }, { $set: { permissions } });
  }

  async findAccountId(email: string): Promise<string | null> {
    const existing = await this.userModel.findOne({ email });
    return existing ? existing._id.toString() : null;
  }

  async createAccount(account: NewSeedAccount): Promise<string> {
    const created = await this.userModel.create({
      _id: new Types.ObjectId(),
      email: account.email,
      name: account.name,
      role: account.role,
      password: account.passwordHash,
      isVerified: true,
      authProvider: AuthProvider.EMAIL,
      permissions: account.permissions,
    });
    return created._id.toString();
  }

  async clearApplicationData(): Promise<void> {
    assertResetAllowed();
    const changelog = changelogCollectionName();
    const skipped = new Set<string>([
      changelog,
      `${changelog}_lock`,
      'changelog_lock',
      'migrations_lock',
    ]);

    const collections = Object.values(this.userModel.db.collections);
    for (const collection of collections) {
      if (skipped.has(collection.collectionName)) {
        continue;
      }
      await collection.deleteMany({});
    }
  }
}

export const MONGO_SEED_STORE: Provider = {
  provide: SeedStore,
  useClass: MongoSeedStore,
};
