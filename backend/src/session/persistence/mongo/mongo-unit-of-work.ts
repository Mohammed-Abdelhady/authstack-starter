import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import {
  pauseBeforeRerun,
  RerunPause,
  UNIT_OF_WORK_RERUN_PAUSE,
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { withMajorityTransaction } from '../../../common/persistence/mongo/mongo-transaction';
import { mapMongoError } from './mongo-persistence-errors';
import { PersistenceUnavailableError } from '../../../common/persistence/persistence-errors';
import {
  MAX_AUTHORITY_OPERATIONS_PER_ACTOR,
  MAX_AUTHORITY_OPERATIONS_TOTAL,
} from './constants/grant-authority';

class MongoUnitOfWork extends UnitOfWork {
  constructor(readonly session: ClientSession) {
    super();
  }
}

/** The transaction's session, for the MongoDB adapter only. */
export function mongoSessionOf(unitOfWork: UnitOfWork): ClientSession {
  if (!(unitOfWork instanceof MongoUnitOfWork)) {
    throw new Error('This unit of work was not opened on MongoDB');
  }
  return unitOfWork.session;
}

/**
 * Lets Mongoose code that still owns its transaction call a converted service.
 * It goes away when that caller moves behind a store.
 */
export function mongoUnitOfWork(session: ClientSession): UnitOfWork {
  return new MongoUnitOfWork(session);
}

@Injectable()
export class MongoUnitOfWorkRunner extends UnitOfWorkRunner {
  private readonly pause: RerunPause;
  private readonly authorityTails = new Map<string, Promise<void>>();
  private readonly authorityDepths = new Map<string, number>();
  private authorityOperations = 0;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Optional() @Inject(UNIT_OF_WORK_RERUN_PAUSE) pause?: RerunPause,
  ) {
    super();
    this.pause = pause ?? pauseBeforeRerun;
  }

  async run<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await withMajorityTransaction(
        this.connection,
        (session) => work(new MongoUnitOfWork(session)),
        this.pause,
      );
    } catch (error) {
      throw mapMongoError(error);
    }
  }

  override async runForAuthority<Result>(
    actorId: string,
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    const key = actorId.toLowerCase();
    const depth = this.authorityDepths.get(key) ?? 0;
    if (
      depth >= MAX_AUTHORITY_OPERATIONS_PER_ACTOR ||
      this.authorityOperations >= MAX_AUTHORITY_OPERATIONS_TOTAL
    ) {
      throw new PersistenceUnavailableError();
    }
    this.authorityDepths.set(key, depth + 1);
    this.authorityOperations += 1;
    const prior = this.authorityTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    this.authorityTails.set(key, tail);
    await prior;
    try {
      return await this.run(work);
    } finally {
      this.authorityOperations -= 1;
      const remaining = (this.authorityDepths.get(key) ?? 1) - 1;
      if (remaining === 0) this.authorityDepths.delete(key);
      else this.authorityDepths.set(key, remaining);
      release();
      if (this.authorityTails.get(key) === tail) {
        this.authorityTails.delete(key);
      }
    }
  }
}
