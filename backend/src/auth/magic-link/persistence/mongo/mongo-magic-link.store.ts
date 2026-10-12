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
import {
  ClaimedMagicLink,
  MAGIC_LINK_CONSTRAINT,
  MagicLinkStore,
  NewMagicLink,
} from '../../stores/magic-link.store';

const MAGIC_LINK_INDEX_CONSTRAINTS = {
  tokenHash_1: MAGIC_LINK_CONSTRAINT.TOKEN_HASH,
} as const;

@Injectable()
export class MongoMagicLinkStore extends MagicLinkStore {
  constructor(
    @InjectModel(PendingMagicLink.name)
    private readonly pendingMagicLinkModel: Model<PendingMagicLinkDocument>,
  ) {
    super();
  }

  countRequestedSince(email: string, since: Date): Promise<number> {
    return singleStatement(() =>
      this.pendingMagicLinkModel.countDocuments({
        email: { $eq: email },
        createdAt: { $gte: since },
      }),
    );
  }

  async insertLink(link: NewMagicLink): Promise<void> {
    await insertOrConflict(MAGIC_LINK_INDEX_CONSTRAINTS, () =>
      this.pendingMagicLinkModel.create({
        email: link.email,
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
        consumedAt: null,
        requestIp: link.requestIp,
        userAgent: link.userAgent,
        ...(link.redirect ? { redirect: link.redirect } : {}),
      }),
    );
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
}
