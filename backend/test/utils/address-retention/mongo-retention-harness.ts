import { once } from 'node:events';
import { createConnection } from 'mongoose';
import { MongoAddressLedger } from '../../../src/common/persistence/mongo/mongo-address-ledger';
import {
  AddressClaim,
  AddressClaimDocument,
  AddressClaimSchema,
} from '../../../src/common/persistence/mongo/schemas/address-claim.schema';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../src/user/persistence/mongo/schemas/user.schema';
// feature:invitations:start
import { MongoInvitationStore } from '../../../src/auth/invitations/persistence/mongo/mongo-invitation.store';
import {
  Invitation,
  InvitationDocument,
  InvitationSchema,
} from '../../../src/auth/invitations/persistence/mongo/invitation.schema';
import { InvitationIssuer } from '../../../src/auth/invitations/services/invitation-issuer';
// feature:invitations:end
import { ADDRESS_CLAIM_KIND } from '../../../src/common/persistence/address-ledger';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import { startSharedMongoServer } from '../memory-replset';

const MINUTE_MS = 60_000;
const EVENT_WAIT_MS = 4000;
const SENTINEL = 'ttl-sentinel@example.test';

export async function bootMongoRetention() {
  const server = await startSharedMongoServer(0, {
    port: 0,
    ttlMonitorSleepSecs: 1,
  });
  const connection = createConnection(server.uri);
  const close = async () => {
    try {
      await connection.close();
    } finally {
      await server.stop();
    }
  };
  try {
    await connection.asPromise();
    connection.model(AddressClaim.name, AddressClaimSchema);
    const claims = connection.model<AddressClaimDocument>(AddressClaim.name);
    connection.model(User.name, UserSchema);
    const users = connection.model<UserDocument>(User.name);
    // feature:invitations:start
    connection.model(Invitation.name, InvitationSchema);
    const invitations = connection.model<InvitationDocument>(Invitation.name);
    await invitations.init();
    // feature:invitations:end
    await Promise.all([claims.init(), users.init()]);
    const ledger = new MongoAddressLedger(claims, users);
    const runner = new MongoUnitOfWorkRunner(connection);
    // Only expired rows follow server time; all live rows use the frozen future.
    const clock = new FrozenClock(new Date(Date.now() - 2 * MINUTE_MS));
    const past = clock.now();
    return {
      connection,
      claims,
      users,
      ledger,
      runner,
      clock,
      past,
      // feature:invitations:start
      issuer: new InvitationIssuer(
        new MongoInvitationStore(invitations, users),
        ledger,
        clock,
      ),
      // feature:invitations:end
      reset: async () => {
        clock.set(past);
        await claims.deleteMany({});
        await users.deleteMany({});
        await invitations.deleteMany({}); // feature:invitations
      },
      close,
      ttlPass: async (whileOpen?: () => Promise<void>) => {
        const stream = claims.collection.watch(
          [
            {
              $match: { operationType: 'delete', 'documentKey._id': SENTINEL },
            },
          ],
          { maxAwaitTimeMS: 1000 },
        );
        const abort = new AbortController();
        const bound = setTimeout(() => abort.abort(), EVENT_WAIT_MS);
        try {
          const ready = once(stream, 'resumeTokenChanged', {
            signal: abort.signal,
          });
          const deleted = once(stream, 'change', { signal: abort.signal });
          // Attach rejection handlers before any owned write can fail.
          void ready.catch(() => undefined);
          void deleted.catch(() => undefined);
          await ready;
          await claims.create({
            _id: SENTINEL,
            kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
            owner: 'sentinel-owner',
            lapsesAt: new Date(past.getTime() + MINUTE_MS),
          });
          await whileOpen?.();
          await deleted;
        } finally {
          clearTimeout(bound);
          abort.abort();
          await stream.close();
        }
      },
      liveAt: TEST_NOW,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type MongoRetentionHarness = Awaited<
  ReturnType<typeof bootMongoRetention>
>;
