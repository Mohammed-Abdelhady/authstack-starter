// feature:passkeys:start
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { mongoSessionOf } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import type { EnrolmentCredentialFixture } from './enrolment-credential-fixture';

export function mongoEnrolmentCredentials(
  app: INestApplication,
): EnrolmentCredentialFixture {
  const connection = app.get<Connection>(getConnectionToken());
  const passkeys = connection.collection('passkeys');
  return {
    insertIn: async (work, userId, credentialId, at) => {
      await passkeys.insertOne(
        {
          user: new Types.ObjectId(userId),
          credentialId,
          publicKey: Buffer.from([0, 255, 1, 128]),
          counter: 0,
          transports: ['internal'],
          backedUp: false,
          name: 'Enrolment transaction credential',
          lastUsedAt: null,
          createdAt: at,
          updatedAt: at,
        },
        { session: mongoSessionOf(work) },
      );
    },
    count: (userId) =>
      passkeys.countDocuments({ user: new Types.ObjectId(userId) }),
    revocationReason: async (sessionId) => {
      const row = await connection
        .collection<{ revokedReason?: string }>('sessions')
        .findOne({ _id: new Types.ObjectId(sessionId) });
      return row?.revokedReason ?? null;
    },
    audienceRefusals: async (userId) => {
      const rows = await connection
        .collection<{ clientId?: string; outcome: string }>('securityevents')
        .find({ targetUserId: userId, action: 'audience_refused' })
        .toArray();
      return rows.map(({ clientId, outcome }) => ({
        clientId: clientId ?? null,
        outcome,
      }));
    },
  };
}
// feature:passkeys:end
