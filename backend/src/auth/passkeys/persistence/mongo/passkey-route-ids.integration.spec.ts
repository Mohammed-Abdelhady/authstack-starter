import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { type Response } from 'supertest';
import {
  SEED_MANAGER,
  SEED_USER,
} from '../../../../../test/constants/seed-users';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../../../../../test/utils/e2e-app';
import {
  ABSENT_ID,
  MALFORMED_ID_ANSWER,
  MALFORMED_IDS,
  refusal,
  refusalAnswer,
} from '../../../../../test/utils/route-id-answers';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { Passkey, PasskeyDocument } from './schemas/passkey.schema';

interface PasskeyRoute {
  name: string;
  send: (caller: TestAgent, id: string, body?: object) => Promise<Response>;
  body?: object;
}

const NOT_FOUND = refusal(404, 'PASSKEY_NOT_FOUND', 'Passkey not found');
const NO_SESSION = refusal(401, 'SESSION_REQUIRED', 'Authentication required');

const ROUTES: PasskeyRoute[] = [
  {
    name: 'PATCH /auth/passkeys/:id',
    send: (caller, id, body) =>
      caller.patch(`/api/auth/passkeys/${id}`).send(body),
    body: { name: 'Renamed' },
  },
  {
    name: 'DELETE /auth/passkeys/:id',
    send: (caller, id) => caller.delete(`/api/auth/passkeys/${id}`),
  },
];

describe('answers to a passkey id in the path', () => {
  let e2e: E2eApp;
  let owner: TestAgent;
  let passkeys: Model<PasskeyDocument>;
  let othersPasskeyId: string;

  const storedNames = async (): Promise<string[]> =>
    (await passkeys.find().sort({ name: 1 }).lean().exec()).map(
      (passkey) => passkey.name,
    );

  beforeAll(async () => {
    e2e = await bootE2eApp();
    owner = await loginAs(e2e.httpServer, SEED_USER);
    passkeys = e2e.app.get<Model<PasskeyDocument>>(getModelToken(Passkey.name));
    const users = e2e.app.get<Model<UserDocument>>(getModelToken(User.name));
    const accountId = async (email: string): Promise<Types.ObjectId> => {
      const account = await users.findOne({ email }).exec();
      if (!account) throw new Error(`${email} was not seeded`);
      return account._id;
    };
    const stored = await passkeys.create([
      {
        user: await accountId(SEED_USER.email),
        credentialId: 'owner-credential',
        publicKey: Buffer.from([1, 2, 3]),
        name: 'Owner key',
      },
      {
        user: await accountId(SEED_MANAGER.email),
        credentialId: 'other-credential',
        publicKey: Buffer.from([4, 5, 6]),
        name: 'Other key',
      },
    ]);
    othersPasskeyId = stored[1]._id.toString();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe.each(ROUTES)('$name', (route) => {
    it.each(MALFORMED_IDS)('refuses %s as an id', async (_, id) => {
      const response = await route.send(owner, id, route.body);

      expect(refusalAnswer(response)).toEqual(MALFORMED_ID_ANSWER);
    });

    it('answers not found for a well-formed id that names nothing', async () => {
      const response = await route.send(owner, ABSENT_ID, route.body);

      expect(refusalAnswer(response)).toEqual(NOT_FOUND);
    });

    it("answers not found for another account's passkey and leaves it", async () => {
      const response = await route.send(owner, othersPasskeyId, route.body);

      expect(refusalAnswer(response)).toEqual(NOT_FOUND);
      expect(await storedNames()).toEqual(['Other key', 'Owner key']);
    });

    it('tells a caller without a session nothing about the id', async () => {
      const anonymous = request(e2e.httpServer);

      const answers = [
        refusalAnswer(await route.send(anonymous, 'not-an-id', route.body)),
        refusalAnswer(await route.send(anonymous, ABSENT_ID, route.body)),
      ];

      expect(answers).toEqual([NO_SESSION, NO_SESSION]);
    });
  });

  it('refuses the id before a name it would also refuse', async () => {
    const response = await owner
      .patch('/api/auth/passkeys/not-an-id')
      .send({ name: '' });

    expect(refusalAnswer(response)).toEqual(MALFORMED_ID_ANSWER);
  });
});
