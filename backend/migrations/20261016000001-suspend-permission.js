// Suspending has its own permission. Every role and direct grant that could
// suspend through the update permission keeps that power. The marker records
// what this run added, so the down migration removes exactly that.
const MARKER = 'migrationMarkers.suspendPermission20261016';
const GRANTS = [
  { from: 'users:update:all', to: 'users:suspend:all' },
  { from: 'users:update:staff', to: 'users:suspend:staff' },
];
const COLLECTIONS = ['roles', 'users'];

module.exports = {
  async up(db) {
    for (const name of COLLECTIONS) {
      const collection = db.collection(name);
      for (const { from, to } of GRANTS) {
        const result = await collection.updateMany(
          { permissions: { $eq: from, $ne: to } },
          { $addToSet: { permissions: to, [MARKER]: to } },
        );
        console.log(`Gave ${to} to ${result.modifiedCount} ${name}`);
      }
    }
  },

  async down(db) {
    for (const name of COLLECTIONS) {
      const collection = db.collection(name);
      const marked = collection.find({ [MARKER]: { $exists: true } });
      for await (const document of marked) {
        const added = Array.isArray(
          document.migrationMarkers?.suspendPermission20261016,
        )
          ? document.migrationMarkers.suspendPermission20261016
          : [];
        await collection.updateOne(
          { _id: document._id },
          { $pullAll: { permissions: added }, $unset: { [MARKER]: '' } },
        );
      }
    }
  },
};
