import {
  ROUTE_ID_REFUSAL,
  routeIdAnswer,
} from '../../../../test/utils/route-id-answers';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { RouteIdPipe } from '../../../common/pipes/route-id.pipe';
import {
  CREDENTIAL_ID,
  NOW,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  rejectionOf,
} from './passkeys-contract.harness-spec';

/** A passkey id as the rename and remove routes take it. */
export function routeIdCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('lets a passkey id this database hands out through a route', async () => {
    const { ownerId } = fixture();
    const passkeyId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      createdAt: NOW,
    });
    const absent = harness().absentId();
    const pipe = new RouteIdPipe(harness().ids);

    expect([
      routeIdAnswer(pipe, passkeyId),
      routeIdAnswer(pipe, absent),
    ]).toEqual([passkeyId, absent]);
  });

  it('refuses a malformed passkey id at a route, in a rename and in a removal, and changes nothing', async () => {
    const { ownerId } = fixture();
    const { management } = passkeyServices(harness());
    const pipe = new RouteIdPipe(harness().ids);
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      name: 'Kept name',
      createdAt: NOW,
    });

    for (const id of ['not-an-id', '', harness().foreignId()]) {
      const renamed = await rejectionOf(
        management.rename(ownerId, id, { name: 'Taken over' }),
      );
      const removed = await rejectionOf(management.remove(ownerId, id));

      expect({
        route: routeIdAnswer(pipe, id),
        rename: renamed instanceof MalformedIdError,
        remove: removed instanceof MalformedIdError,
      }).toEqual({ route: ROUTE_ID_REFUSAL, rename: true, remove: true });
    }
    expect(
      (await harness().storedPasskeys()).map((passkey) => passkey.name),
    ).toEqual(['Kept name']);
  });
}
