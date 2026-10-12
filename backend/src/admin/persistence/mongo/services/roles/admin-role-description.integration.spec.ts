import { ClientSessionOptions } from 'mongoose';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { MONGO_TRANSIENT_TRANSACTION_LABEL } from '../../../../../common/constants/mongo-errors';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

describe('description edits use the role transaction', () => {
  const fixture = useAdminRoundFour('round_five_description');
  it('persists an authorized description edit without revoking holder sessions', async () => {
    const { h } = fixture;
    const holder = await fixture.seed(
      'description-holder@example.test',
      EDITOR_SLUG,
    );
    const answer = await h.roles.update(
      EDITOR_SLUG,
      { description: 'Editorial access' },
      fixture.roleActorId,
    );
    expect(answer.description).toBe('Editorial access');
    expect(
      (await h.roleModel.findOne({ slug: EDITOR_SLUG }))?.description,
    ).toBe('Editorial access');
    expect((await h.users.findById(holder._id))?.sessionVersion).toBe(0);
    expect(await h.events.countDocuments({})).toBe(0);
  });
  it('rolls back a description edit after certain transient commit failures', async () => {
    const { h } = fixture;
    const start = h.connection.startSession.bind(h.connection);
    jest
      .spyOn(h.connection, 'startSession')
      .mockImplementation(async (options?: ClientSessionOptions) => {
        const session = await start(options);
        const transient = new MongoServerError({
          message: 'transaction aborted',
          code: 112,
        });
        transient.addErrorLabel(MONGO_TRANSIENT_TRANSACTION_LABEL);
        jest.spyOn(session, 'commitTransaction').mockRejectedValue(transient);
        return session;
      });
    await expect(
      h.roles.update(
        EDITOR_SLUG,
        { description: 'Rejected edit' },
        fixture.roleActorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: 503,
    });
    expect(
      (await h.roleModel.findOne({ slug: EDITOR_SLUG }))?.description,
    ).toBeUndefined();
    expect(await h.events.countDocuments({})).toBe(0);
  });

  it.each([
    {
      commitLands: true,
      description: 'Committed without acknowledgement',
      storedDescription: 'Committed without acknowledgement',
    },
    {
      commitLands: false,
      description: 'Not committed before the answer was lost',
      storedDescription: undefined,
    },
  ])(
    'answers unknown when the description commit may have landed ($commitLands)',
    async ({ commitLands, description, storedDescription }) => {
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

      await expect(
        h.roles.update(EDITOR_SLUG, { description }, fixture.roleActorId),
      ).rejects.toMatchObject({
        code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        status: 503,
      });
      expect(
        (await h.roleModel.findOne({ slug: EDITOR_SLUG }))?.description,
      ).toBe(storedDescription);
    },
  );
});
