import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { escapeRegex } from '../../../common/utils/escape-regex';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { Role, RoleDocument } from './schemas/role.schema';
import { RoleCatalogStore } from '../../stores/role-catalog.store';
import {
  RoleListPage,
  RoleListQuery,
  StoredRole,
} from '../../stores/role-records';
import { RoleLevelSource } from '../../utils/role.util';
import { isObjectIdText, toStoredRole } from './mongo-role-mappers';

@Injectable()
export class MongoRoleCatalogStore extends RoleCatalogStore {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  async findRole(idOrSlug: string): Promise<StoredRole | null> {
    const role = isObjectIdText(idOrSlug)
      ? await this.roleModel.findById(idOrSlug)
      : await this.roleModel.findOne({ slug: { $eq: idOrSlug } });
    return role ? toStoredRole(role) : null;
  }

  async findRoleBySlug(slug: string): Promise<StoredRole | null> {
    const role = await this.roleModel.findOne({ slug: { $eq: slug } });
    return role ? toStoredRole(role) : null;
  }

  async listRoles(query: RoleListQuery): Promise<RoleListPage> {
    const filter: FilterQuery<RoleDocument> = {};
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { slug: { $regex: escaped, $options: 'i' } },
      ];
    }
    const [roles, total] = await Promise.all([
      this.roleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean()
        .exec(),
      this.roleModel.countDocuments(filter),
    ]);
    return { roles: roles.map(toStoredRole), total };
  }

  countHolders(slug: string): Promise<number> {
    return this.userModel.countDocuments({ role: slug });
  }

  readRoleLevel(slug: string): Promise<RoleLevelSource | null> {
    return this.roleModel
      .findOne({ slug: { $eq: slug } })
      .select('slug level')
      .lean<RoleLevelSource | null>()
      .exec();
  }

  listRoleLevels(): Promise<RoleLevelSource[]> {
    return this.roleModel
      .find()
      .select('slug level')
      .lean<RoleLevelSource[]>()
      .exec();
  }

  readRoleLevelInWork(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<RoleLevelSource | null> {
    return this.roleModel
      .findOne({ slug: { $eq: slug } })
      .select('slug level')
      .session(mongoSessionOf(unitOfWork))
      .lean<RoleLevelSource | null>()
      .exec();
  }
}
