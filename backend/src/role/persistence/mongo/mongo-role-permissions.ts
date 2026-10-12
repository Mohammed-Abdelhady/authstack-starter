import { Injectable, Provider } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { RolePermissions } from '../../stores/role-permissions';

/** A failure leaves as the driver raised it: no caller answers one itself. */
@Injectable()
export class MongoRolePermissions extends RolePermissions {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {
    super();
  }

  async ofRole(slug: string): Promise<string[] | null> {
    const role = await this.roleModel.findOne({ slug }).exec();
    return role?.permissions ?? null;
  }
}

export const MONGO_ROLE_PERMISSIONS: Provider = {
  provide: RolePermissions,
  useClass: MongoRolePermissions,
};
