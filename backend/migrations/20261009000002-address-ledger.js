const NORMALISED_EMAIL = { $toLower: { $trim: { input: '$email' } } };
const CLAIM_KIND = 'EMAIL_CHANGE';
const CODE_PURPOSE = 'email-change';

async function backfill(db, session, now) {
  const counts = {
    kept: 0,
    cleared_taken: 0,
    cleared_ambiguous: 0,
    cleared_codeless: 0,
    codes_killed: 0,
  };
  const users = db.collection('users');
  const codes = db.collection('pendingregistrations');
  const claims = db.collection('addressclaims');
  const groups = users.aggregate(
    [
      { $match: { pendingEmail: { $type: 'string' } } },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$pendingEmail' } } },
          members: {
            $push: {
              id: '$_id',
              generation: { $ifNull: ['$addressGeneration', 0] },
            },
          },
        },
      },
    ],
    { session },
  );
  for await (const group of groups) {
    const address = group._id;
    const taken = await users.findOne({ email: address }, { session });
    const addressCodes = await codes
      .find(
        {
          purpose: CODE_PURPOSE,
          $expr: { $eq: [NORMALISED_EMAIL, { $literal: address }] },
        },
        { session },
      )
      .toArray();
    const matches = group.members.flatMap((member) => {
      const matchingCodes = addressCodes.filter(
        (code) =>
          code.expiresAt instanceof Date &&
          code.expiresAt > now &&
          String(code.userId) === String(member.id) &&
          code.addressGeneration === member.generation,
      );
      if (matchingCodes.length === 0) return [];
      const lapsesAt = matchingCodes.reduce(
        (earliest, code) =>
          code.expiresAt < earliest ? code.expiresAt : earliest,
        matchingCodes[0].expiresAt,
      );
      return [{ member, lapsesAt }];
    });
    const keeper = !taken && matches.length === 1 ? matches[0] : undefined;
    if (keeper) {
      const claim = {
        kind: CLAIM_KIND,
        owner: String(keeper.member.id),
        lapsesAt: keeper.lapsesAt,
      };
      const existing = await claims.findOne({ _id: address }, { session });
      if (
        existing &&
        (existing.kind !== claim.kind ||
          existing.owner !== claim.owner ||
          existing.lapsesAt.getTime() !== claim.lapsesAt.getTime())
      ) {
        throw new Error(`Address backfill conflicts with claim: ${address}`);
      }
      const inserted = await claims.updateOne(
        { _id: address },
        { $setOnInsert: claim },
        { session, upsert: true },
      );
      counts.kept += inserted.upsertedCount;
      await users.updateOne(
        { _id: keeper.member.id, pendingEmail: { $ne: address } },
        { $set: { pendingEmail: address } },
        { session },
      );
    }
    const clearedIds = group.members
      .filter((member) => !keeper || !member.id.equals(keeper.member.id))
      .map((member) => member.id);
    if (clearedIds.length > 0) {
      const cleared = await users.updateMany(
        { _id: { $in: clearedIds } },
        { $unset: { pendingEmail: '' } },
        { session },
      );
      if (taken) counts.cleared_taken += cleared.modifiedCount;
      else if (group.members.length > 1 || matches.length > 1) {
        counts.cleared_ambiguous += cleared.modifiedCount;
      } else counts.cleared_codeless += cleared.modifiedCount;
      // A keeper preserves every code variant for its folded address.
      if (!keeper && addressCodes.length > 0) {
        const killed = await codes.deleteMany(
          { _id: { $in: addressCodes.map((code) => code._id) } },
          { session },
        );
        counts.codes_killed += killed.deletedCount;
      }
    }
  }
  return counts;
}

module.exports = {
  async up(db, client) {
    const now = new Date();
    const session = client.startSession();
    try {
      const counts = await session.withTransaction(
        async () => {
          const users = db.collection('users');
          const collisions = await users
            .aggregate(
              [
                { $match: { email: { $type: 'string' } } },
                {
                  $group: {
                    _id: NORMALISED_EMAIL,
                    ids: { $push: '$_id' },
                    count: { $sum: 1 },
                  },
                },
                { $match: { count: { $gt: 1 } } },
              ],
              { session },
            )
            .toArray();
          if (collisions.length > 0) {
            const ids = collisions
              .flatMap((group) => group.ids.map((id) => String(id)))
              .sort();
            throw new Error(
              `Address normalisation collision: ${ids.length} users, ids: ${ids.join(', ')}`,
            );
          }
          await users.updateMany(
            {
              email: { $type: 'string' },
              $expr: { $ne: ['$email', NORMALISED_EMAIL] },
            },
            [{ $set: { email: NORMALISED_EMAIL } }],
            { session },
          );
          return backfill(db, session, now);
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        },
      );
      console.log(
        `Address ledger backfill: kept=${counts.kept} cleared_taken=${counts.cleared_taken} cleared_ambiguous=${counts.cleared_ambiguous} cleared_codeless=${counts.cleared_codeless} codes_killed=${counts.codes_killed}`,
      );
    } finally {
      await session.endSession();
    }
  },

  async down() {
    // Original casing cannot be restored. Keep the canonical addresses.
  },
};
