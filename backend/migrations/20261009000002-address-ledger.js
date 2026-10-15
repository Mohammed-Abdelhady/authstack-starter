const NORMALISED_EMAIL = { $toLower: { $trim: { input: '$email' } } };

module.exports = {
  async up(db, client) {
    const session = client.startSession();
    try {
      await session.withTransaction(
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
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        },
      );
    } finally {
      await session.endSession();
    }
  },

  async down() {
    // Original casing cannot be restored. Keep the canonical addresses.
  },
};
