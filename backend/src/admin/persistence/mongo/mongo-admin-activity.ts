import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';

interface ActivityRow {
  _id: Types.ObjectId;
  activity: { lastUsedAt: Date }[];
}

export async function mongoAdminActivity(
  users: Model<UserDocument>,
  ids: readonly string[],
  session?: ClientSession,
): Promise<Map<string, Date | null>> {
  if (ids.length === 0) return new Map();
  const rows = await users
    .aggregate<ActivityRow>([
      { $match: { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } } },
      { $project: { _id: 1 } },
      {
        $lookup: {
          from: 'sessions',
          let: { owner: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$user', '$$owner'] },
                lastUsedAt: { $type: 'date' },
              },
            },
            { $sort: { lastUsedAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, lastUsedAt: 1 } },
          ],
          as: 'activity',
        },
      },
    ])
    .session(session ?? null)
    .exec();
  return new Map(
    rows.map((row) => [
      row._id.toString(),
      row.activity[0]?.lastUsedAt ?? null,
    ]),
  );
}
