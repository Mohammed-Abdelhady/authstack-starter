import { Logger } from '@nestjs/common';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../src/common/persistence/unit-of-work';
import { mongoUnitOfWork } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import { withMajorityTransaction } from '../../../src/common/persistence/mongo/mongo-transaction';
import { SecurityEventService } from '../../../src/session/persistence/mongo/security-event.service';
import { UserDocument } from '../../../src/user/persistence/mongo/schemas/user.schema';
import { MongoRoleChangeStore } from '../../../src/role/persistence/mongo/mongo-role-change.store';
import { MongoRoleHolders } from '../../../src/role/persistence/mongo/mongo-role-holders';
import { MongoRoleSweepStore } from '../../../src/role/persistence/mongo/mongo-role-sweep.store';
import { RoleDocument } from '../../../src/role/persistence/mongo/schemas/role.schema';
import {
  moveRoleHolders as moveHoldersInWork,
  sweepRoleHolders as sweepHolders,
} from '../../../src/role/sweeps/role-holder-sweep';

interface HolderModels {
  userModel: Model<UserDocument>;
  events: SecurityEventService;
}

/** Runs work in a transaction and lets the driver's own errors through. */
class MongoDriverErrorRunner extends UnitOfWorkRunner {
  constructor(private readonly connection: Connection) {
    super();
  }

  run<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    return withMajorityTransaction(this.connection, (session) =>
      work(mongoUnitOfWork(session)),
    );
  }
}

/** The holder move for a spec that owns a Mongoose transaction. */
export function moveRoleHolders(
  input: HolderModels & {
    previousSlugs: string[];
    nextSlug: string;
    actorId: string;
    session: ClientSession;
    holderIds?: Types.ObjectId[];
  },
): Promise<number> {
  return moveHoldersInWork(
    new MongoRoleHolders(input.userModel, input.events),
    mongoUnitOfWork(input.session),
    {
      fromSlugs: input.previousSlugs,
      toSlug: input.nextSlug,
      actorId: input.actorId,
      ...(input.holderIds
        ? { holderIds: input.holderIds.map((id) => id.toString()) }
        : {}),
    },
  );
}

/** The holder sweep for a spec that holds Mongoose models. */
export function sweepRoleHolders(
  input: HolderModels & {
    connection: Connection;
    roleModel: Model<RoleDocument>;
    roleId: Types.ObjectId;
    previousSlug: string;
    actorId: string;
    logger: Logger;
    fenceDestination?: boolean;
    onMoved?: (count: number) => void;
    userId?: Types.ObjectId;
    previousRoleId?: Types.ObjectId;
  },
): Promise<number> {
  const { connection, roleModel, userModel, events } = input;
  return sweepHolders(
    {
      runner: new MongoDriverErrorRunner(connection),
      changes: new MongoRoleChangeStore(roleModel, userModel, events),
      sweeps: new MongoRoleSweepStore(roleModel, userModel, events),
    },
    {
      roleId: input.roleId.toString(),
      previousSlug: input.previousSlug,
      actorId: input.actorId,
      logger: input.logger,
      fenceDestination: input.fenceDestination,
      onMoved: input.onMoved,
      userId: input.userId?.toString(),
      previousRoleId: input.previousRoleId?.toString(),
    },
  );
}
