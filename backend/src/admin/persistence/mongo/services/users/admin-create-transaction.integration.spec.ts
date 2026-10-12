import { MongoNetworkError, MongoServerError } from 'mongodb';
import { ClientSessionOptions } from 'mongoose';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { MONGO_TRANSIENT_TRANSACTION_LABEL } from '../../../../../common/constants/mongo-errors';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

function transientInsertError() {
  const error = new MongoServerError({
    message: 'transaction interrupted',
    code: 112,
  });
  error.addErrorLabel(MONGO_TRANSIENT_TRANSACTION_LABEL);
  return error;
}

describe('administrative creation owns its insert transaction', () => {
  const fixture = useAdminRoundFour('round_five_create_transaction');

  it('retries a transient failure after insertion without retaining the aborted account', async () => {
    const { h } = fixture;
    const insert = h.users.collection.insertOne.bind(h.users.collection);
    jest
      .spyOn(h.users.collection, 'insertOne')
      .mockImplementationOnce(async (...args) => {
        await insert(...args);
        throw transientInsertError();
      });
    const answer = await fixture.create('insert-retry@example.test');
    const account = await h.users.findOne({
      email: 'insert-retry@example.test',
    });
    expect(answer.data?.role).toBe(EDITOR_SLUG);
    expect(account?.role).toBe(EDITOR_SLUG);
    expect(
      await h.users.countDocuments({ email: 'insert-retry@example.test' }),
    ).toBe(1);
    expect(account?.sessionVersion).toBe(0);
  });

  it('allocates a fresh account when the first commit fails transiently', async () => {
    const { h } = fixture;
    const start = h.connection.startSession.bind(h.connection);
    jest
      .spyOn(h.connection, 'startSession')
      .mockImplementationOnce(async (options?: ClientSessionOptions) => {
        const session = await start(options);
        jest
          .spyOn(session, 'commitTransaction')
          .mockRejectedValueOnce(transientInsertError());
        return session;
      });
    await fixture.create('commit-retry@example.test');
    expect(
      await h.users.countDocuments({ email: 'commit-retry@example.test' }),
    ).toBe(1);
    expect(
      (await h.users.findOne({ email: 'commit-retry@example.test' }))
        ?.sessionVersion,
    ).toBe(0);
  });

  it('leaves no account when transaction work fails after insertion', async () => {
    const { h } = fixture;
    const insert = h.users.collection.insertOne.bind(h.users.collection);
    jest
      .spyOn(h.users.collection, 'insertOne')
      .mockImplementationOnce(async (...args) => {
        await insert(...args);
        throw new MongoNetworkError('insert failed before commit');
      });
    await expect(
      fixture.create('commit-failure@example.test'),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: 503,
    });
    expect(
      await h.users.findOne({ email: 'commit-failure@example.test' }),
    ).toBeNull();
    expect(await h.events.countDocuments({})).toBe(0);
  });

  it.each([
    { commitLands: true, email: 'landed-unknown@example.test' },
    { commitLands: false, email: 'absent-unknown@example.test' },
  ])(
    'answers unknown when account creation commit may have landed ($email)',
    async ({ commitLands, email }) => {
      const { h } = fixture;
      const start = h.connection.startSession.bind(h.connection);
      jest
        .spyOn(h.connection, 'startSession')
        .mockImplementationOnce(async (options?: ClientSessionOptions) => {
          const session = await start(options);
          const commit = session.commitTransaction.bind(session);
          jest
            .spyOn(session, 'commitTransaction')
            .mockImplementationOnce(async () => {
              if (commitLands) await commit();
              throw new MongoNetworkError('commit response unavailable');
            });
          return session;
        });

      await expect(fixture.create(email)).rejects.toMatchObject({
        code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        status: 503,
      });

      const account = await h.users.findOne({ email });
      expect(account !== null).toBe(commitLands);
      if (account) {
        expect(account.role).toBe(EDITOR_SLUG);
        expect(
          await h.roleModel.findOne({ slug: account.role }),
        ).not.toBeNull();
      }
    },
  );
});
