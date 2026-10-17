const {
  dropIndexIfExists,
} = require('../migration-support/migration-index-utils');

const COLLECTION = 'addressclaims';
const TTL_INDEX = 'lapsesAt_1';

module.exports = {
  async up(db) {
    await db
      .collection(COLLECTION)
      .createIndex({ lapsesAt: 1 }, { expireAfterSeconds: 0, name: TTL_INDEX });
  },

  async down(db) {
    await dropIndexIfExists(db.collection(COLLECTION), TTL_INDEX);
  },
};
