import type { Connection } from 'mongoose';
import { MongoSessionProofStore } from '../../../../src/auth/proof/persistence/mongo/mongo-session-proof.store';
import {
  SessionProof,
  SessionProofSchema,
  type SessionProofDocument,
} from '../../../../src/auth/proof/persistence/mongo/session-proof.schema';

export async function mongoAccountProofs(connection: Connection) {
  connection.model(SessionProof.name, SessionProofSchema);
  const model = connection.model<SessionProofDocument>(SessionProof.name);
  await model.init();
  return {
    store: new MongoSessionProofStore(model),
    reset: () => model.deleteMany({}).exec(),
  };
}
