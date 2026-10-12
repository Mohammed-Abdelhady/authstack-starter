import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MAIL_COUNTER_CONSTRAINT,
  MAIL_RECORD,
  MailCounterKey,
  MailCounterStore,
  MailRecord,
  MailWindowRule,
} from '../../pending-codes/mail-counter.store';
import {
  MailCounter,
  MailCounterDocument,
} from './schemas/mail-counter.schema';
import {
  insertOrConflict,
  singleStatement,
} from '../../../common/persistence/mongo/mongo-unique-conflict';

const MAIL_COUNTER_INDEX_CONSTRAINTS = {
  email_1_purpose_1: MAIL_COUNTER_CONSTRAINT.ADDRESS_PURPOSE,
} as const;

@Injectable()
export class MongoMailCounterStore extends MailCounterStore {
  constructor(
    @InjectModel(MailCounter.name)
    private readonly mailCounterModel: Model<MailCounterDocument>,
  ) {
    super();
  }

  async recordWithinCap(
    key: MailCounterKey,
    rule: MailWindowRule,
  ): Promise<MailRecord> {
    const { now, windowMs, limit } = rule;
    const windowRolledOver = {
      $gte: [{ $subtract: [now, '$windowStartedAt'] }, windowMs],
    };
    const updated = await singleStatement(() =>
      this.mailCounterModel.findOneAndUpdate(
        {
          email: { $eq: key.email },
          purpose: key.purpose,
          $or: [
            { windowStartedAt: { $lte: new Date(now.getTime() - windowMs) } },
            { mailedCodes: { $lt: limit } },
          ],
        },
        [
          {
            $set: {
              mailedCodes: {
                $cond: [windowRolledOver, 1, { $add: ['$mailedCodes', 1] }],
              },
              windowStartedAt: {
                $cond: [windowRolledOver, now, '$windowStartedAt'],
              },
              // Never earlier than the guess count here is still needed.
              expiresAt: {
                $max: [
                  {
                    $add: [
                      { $cond: [windowRolledOver, now, '$windowStartedAt'] },
                      windowMs,
                    ],
                  },
                  '$guessStateExpiresAt',
                ],
              },
            },
          },
        ],
        { new: true, select: '_id' },
      ),
    );
    return updated ? MAIL_RECORD.RECORDED : MAIL_RECORD.NOT_RECORDED;
  }

  async hasCounter(key: MailCounterKey): Promise<boolean> {
    const existing = await singleStatement(() =>
      this.mailCounterModel.exists({
        email: { $eq: key.email },
        purpose: key.purpose,
      }),
    );
    return existing !== null;
  }

  async openCounter(
    key: MailCounterKey,
    window: { now: Date; windowMs: number },
  ): Promise<void> {
    await insertOrConflict(MAIL_COUNTER_INDEX_CONSTRAINTS, () =>
      this.mailCounterModel.create({
        email: key.email,
        purpose: key.purpose,
        mailedCodes: 1,
        windowStartedAt: window.now,
        expiresAt: new Date(window.now.getTime() + window.windowMs),
      }),
    );
  }

  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const deleted = await singleStatement(() =>
      this.mailCounterModel.deleteMany({
        expiresAt: { $lte: cutoff },
      }),
    );
    return deleted.deletedCount;
  }
}
