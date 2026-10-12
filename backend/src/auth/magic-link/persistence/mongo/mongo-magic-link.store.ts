import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  insertOrConflict,
  singleStatement,
} from '../../../../common/persistence/mongo/mongo-unique-conflict';
import {
  PendingMagicLink,
  PendingMagicLinkDocument,
} from './schemas/pending-magic-link.schema';
import { MAIL_COUNTER_PURPOSE } from '../../../constants/registration';
import { MailWindowRule } from '../../../pending-codes/mail-counter.store';
import {
  MailCounter,
  MailCounterDocument,
} from '../../../persistence/mongo/schemas/mail-counter.schema';
import {
  ClaimedMagicLink,
  MAGIC_LINK_CONSTRAINT,
  MagicLinkStore,
  NewMagicLink,
  UnspentMagicLink,
} from '../../stores/magic-link.store';

const MAGIC_LINK_INDEX_CONSTRAINTS = {
  tokenHash_1: MAGIC_LINK_CONSTRAINT.TOKEN_HASH,
} as const;

@Injectable()
export class MongoMagicLinkStore extends MagicLinkStore {
  constructor(
    @InjectModel(PendingMagicLink.name)
    private readonly pendingMagicLinkModel: Model<PendingMagicLinkDocument>,
    @InjectModel(MailCounter.name)
    private readonly mailCounterModel: Model<MailCounterDocument>,
  ) {
    super();
  }

  /**
   * One upsert on the counter's unique key. The update reads the counter as
   * it is when the write lands.
   */
  async takeRequestSlot(email: string, rule: MailWindowRule): Promise<boolean> {
    const windowEnd = new Date(rule.now.getTime() + rule.windowMs);
    const rolledOverBefore = new Date(rule.now.getTime() - rule.windowMs);
    // A counter that is not stored yet starts a window like one that ended.
    const rolledOver = {
      $lte: [
        { $ifNull: ['$windowStartedAt', rolledOverBefore] },
        rolledOverBefore,
      ],
    };
    const counter = await singleStatement(() =>
      this.mailCounterModel.findOneAndUpdate(
        { email: { $eq: email }, purpose: MAIL_COUNTER_PURPOSE.MAGIC_LINK },
        [
          {
            $set: {
              mailedCodes: {
                $cond: [rolledOver, 1, { $add: ['$mailedCodes', 1] }],
              },
              windowStartedAt: {
                $cond: [rolledOver, rule.now, '$windowStartedAt'],
              },
              expiresAt: { $cond: [rolledOver, windowEnd, '$expiresAt'] },
            },
          },
        ],
        { upsert: true, new: true, select: 'mailedCodes' },
      ),
    );
    return counter !== null && counter.mailedCodes <= rule.limit;
  }

  async insertLink(link: NewMagicLink): Promise<void> {
    await insertOrConflict(MAGIC_LINK_INDEX_CONSTRAINTS, () =>
      this.pendingMagicLinkModel.create({
        email: link.email,
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
        consumedAt: link.consumedAt ?? null,
        requestIp: link.requestIp,
        userAgent: link.userAgent,
        ...(link.redirect ? { redirect: link.redirect } : {}),
        ...(link.requestNonceHash
          ? { requestNonceHash: link.requestNonceHash }
          : {}),
      }),
    );
  }

  async findUnspentLink(tokenHash: string): Promise<UnspentMagicLink | null> {
    const link = await singleStatement(() =>
      this.pendingMagicLinkModel
        .findOne({ tokenHash: { $eq: tokenHash }, consumedAt: null })
        .select('email expiresAt requestNonceHash')
        .lean(),
    );
    return link
      ? {
          email: link.email,
          expiresAt: link.expiresAt,
          requestNonceHash: link.requestNonceHash ?? null,
        }
      : null;
  }

  async claimLink(
    tokenHash: string,
    now: Date,
  ): Promise<ClaimedMagicLink | null> {
    const link = await singleStatement(() =>
      this.pendingMagicLinkModel.findOneAndUpdate(
        { tokenHash, consumedAt: null },
        { $set: { consumedAt: now } },
        { new: true },
      ),
    );
    if (!link) {
      return null;
    }
    return {
      email: link.email,
      expiresAt: link.expiresAt,
      ...(link.redirect ? { redirect: link.redirect } : {}),
    };
  }

  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const deleted = await singleStatement(() =>
      this.pendingMagicLinkModel.deleteMany({
        expiresAt: { $lte: cutoff },
      }),
    );
    return deleted.deletedCount;
  }
}
