import { Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Clock } from '../../../common/services/clock';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { MongoSessionRevocationStore } from './mongo-session-revocation.store';
import { mongoUnitOfWork, MongoUnitOfWorkRunner } from './mongo-unit-of-work';
import {
  RevocationContext,
  SessionRevoker,
} from '../../revocation/session-revoker';
import { Session, SessionDocument } from './schemas/session.schema';
import { SecurityEventService } from './security-event.service';

export type { RevocationContext };

/**
 * The MongoDB face of revocation, for callers that still hold Mongoose ids or
 * own a driver transaction. Every decision is `SessionRevoker`'s; this turns
 * the id into its string and the caller's session into the unit of work. It
 * goes away when those callers pass a unit of work themselves.
 */
@Injectable()
export class SessionRevocationService {
  private readonly revoker: SessionRevoker;

  constructor(
    @InjectConnection() connection: Connection,
    @InjectModel(Session.name)
    sessionModel: Model<SessionDocument>,
    @InjectModel(User.name) userModel: Model<UserDocument>,
    events: SecurityEventService,
    clock: Clock,
    @Optional() revoker?: SessionRevoker,
  ) {
    this.revoker =
      revoker ??
      new SessionRevoker(
        new MongoUnitOfWorkRunner(connection),
        new MongoSessionRevocationStore(sessionModel, userModel, events),
        clock,
      );
  }

  revokeByToken(token: string): Promise<boolean> {
    return this.revoker.revokeByToken(token);
  }

  revokeById(sessionId: string, userId: Types.ObjectId): Promise<boolean> {
    return this.revoker.revokeById(sessionId, userId.toString());
  }

  revokeAllForUser(
    userId: Types.ObjectId,
    db?: ClientSession,
    context?: RevocationContext,
  ): Promise<number> {
    const id = userId.toString();
    return db
      ? this.revoker.revokeAllForUserIn(mongoUnitOfWork(db), id, context)
      : this.revoker.revokeAllForUser(id, context);
  }

  revokeAllOthersExceptSession(
    userId: Types.ObjectId,
    exceptSessionId: string,
    db?: ClientSession,
  ): Promise<number> {
    const id = userId.toString();
    return db
      ? this.revoker.revokeAllOthersExceptSessionIn(
          mongoUnitOfWork(db),
          id,
          exceptSessionId,
        )
      : this.revoker.revokeAllOthersExceptSession(id, exceptSessionId);
  }
}
