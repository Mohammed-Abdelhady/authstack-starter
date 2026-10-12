import * as bcrypt from 'bcrypt';
import {
  BCRYPT_ROUNDS,
  CREDENTIAL_ID,
  FeatureSwitches,
  NOW,
  OTHER_CREDENTIAL_ID,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  PASSWORD,
  refusalOf,
} from './passkeys-contract.harness-spec';

const NOT_FOUND = { code: 'PASSKEY_NOT_FOUND', status: 404 };
const LAST_WAY_IN = { code: 'PASSKEY_LAST_SIGN_IN_METHOD', status: 409 };
const EARLIER = new Date('2099-01-01T11:00:00.000Z');

/** The passkeys on an account, from its settings. */
export function managementCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('lists the passkeys of the account newest first, and nobody else has them listed', async () => {
    const { ownerId, otherId } = fixture();
    const { management } = passkeyServices(harness());
    const olderId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      name: 'Older key',
      createdAt: EARLIER,
    });
    const newerId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: OTHER_CREDENTIAL_ID,
      name: 'Newer key',
      createdAt: NOW,
    });

    expect((await management.list(ownerId)).data.passkeys).toEqual([
      {
        id: newerId,
        name: 'Newer key',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: NOW,
        lastUsedAt: null,
      },
      {
        id: olderId,
        name: 'Older key',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: EARLIER,
        lastUsedAt: null,
      },
    ]);
    expect((await management.list(otherId)).data.passkeys).toEqual([]);
    expect((await management.list(harness().absentId())).data.passkeys).toEqual(
      [],
    );
    expect(await harness().profilePasskeyCount(ownerId)).toBe(2);
    expect(await harness().profilePasskeyCount(otherId)).toBe(0);
  });

  it('renames a passkey of the account and reads another account`s as absent', async () => {
    const { ownerId, otherId } = fixture();
    const { management } = passkeyServices(harness());
    const passkeyId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      name: 'Old name',
      createdAt: NOW,
    });

    expect(
      await refusalOf(
        management.rename(otherId, passkeyId, { name: 'Taken over' }),
      ),
    ).toEqual(NOT_FOUND);
    expect(
      await refusalOf(
        management.rename(ownerId, harness().absentId(), { name: 'Nothing' }),
      ),
    ).toEqual(NOT_FOUND);
    expect((await harness().storedPasskeys())[0].name).toBe('Old name');

    const renamed = await management.rename(ownerId, passkeyId, {
      name: '  Work laptop  ',
    });

    expect(renamed.data).toMatchObject({
      id: passkeyId,
      name: 'Work laptop',
    });
    expect((await harness().storedPasskeys())[0]).toMatchObject({
      id: passkeyId,
      name: 'Work laptop',
      counter: 0,
      lastUsedAt: null,
    });
  });

  it('removes one of several passkeys and refuses one that is not the caller`s', async () => {
    const { ownerId, otherId } = fixture();
    const { management } = passkeyServices(harness(), { password: false });
    const firstId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      createdAt: EARLIER,
    });
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: OTHER_CREDENTIAL_ID,
      createdAt: NOW,
    });

    expect(await refusalOf(management.remove(otherId, firstId))).toEqual(
      NOT_FOUND,
    );
    expect(await harness().storedPasskeys()).toHaveLength(2);

    await management.remove(ownerId, firstId);

    expect(
      (await harness().storedPasskeys()).map((passkey) => passkey.credentialId),
    ).toEqual([OTHER_CREDENTIAL_ID]);
    expect(await refusalOf(management.remove(ownerId, firstId))).toEqual(
      NOT_FOUND,
    );
  });

  it('keeps the last passkey only while it is the one way into the account', async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
    const accounts: Record<
      string,
      {
        account: { passwordHash?: string; linked?: boolean };
        features: FeatureSwitches;
        kept: boolean;
      }
    > = {
      'nothing else': { account: {}, features: {}, kept: true },
      'a password': { account: { passwordHash }, features: {}, kept: false }, // feature:email-password
      'a password that cannot be used': {
        account: { passwordHash },
        features: { password: false },
        kept: true,
      },
      'a linked provider': {
        account: { linked: true },
        features: { password: false },
        kept: false,
      },
      // feature:magic-link:start
      'magic links': {
        account: {},
        features: { password: false, magicLink: true },
        kept: false,
      },
      // feature:magic-link:end
    };

    const kept: Record<string, boolean> = {};
    for (const [name, { account, features }] of Object.entries(accounts)) {
      await harness().reset();
      const userId = await harness().seedAccount({
        email: 'last-way-in@example.test',
        ...account,
      });
      const passkeyId = await harness().seedPasskey({
        userId,
        credentialId: CREDENTIAL_ID,
        createdAt: NOW,
      });
      // Another account's passkeys are not this account's other ways in.
      const neighbourId = await harness().seedAccount({
        email: 'neighbour@example.test',
      });
      for (const credentialId of ['bmVpZ2hib3VyLTE', 'bmVpZ2hib3VyLTI']) {
        await harness().seedPasskey({
          userId: neighbourId,
          credentialId,
          createdAt: NOW,
        });
      }
      const { management } = passkeyServices(harness(), features);

      const attempt = management.remove(userId, passkeyId);
      if (accounts[name].kept) {
        expect(await refusalOf(attempt)).toEqual(LAST_WAY_IN);
      } else {
        await attempt;
      }
      kept[name] = (await harness().storedPasskeys()).some(
        (passkey) => passkey.id === passkeyId,
      );
    }

    expect(kept).toEqual({
      'nothing else': true,
      'a password': false, // feature:email-password
      'a password that cannot be used': true,
      'a linked provider': false,
      'magic links': false, // feature:magic-link
    });
  });

  it('removes a passkey of an account that has a second one or is gone', async () => {
    const { management } = passkeyServices(harness(), { password: false });
    await harness().reset();
    const userId = await harness().seedAccount({ email: 'two@example.test' });
    const firstId = await harness().seedPasskey({
      userId,
      credentialId: CREDENTIAL_ID,
      createdAt: EARLIER,
    });
    const secondId = await harness().seedPasskey({
      userId,
      credentialId: OTHER_CREDENTIAL_ID,
      createdAt: NOW,
    });

    await management.remove(userId, firstId);
    expect(await refusalOf(management.remove(userId, secondId))).toEqual(
      LAST_WAY_IN,
    );
    expect(await harness().storedPasskeys()).toHaveLength(1);

    // Nothing can be locked out of an account that no longer exists.
    await harness().removeAccount(userId);
    await management.remove(userId, secondId);
    expect(await harness().storedPasskeys()).toEqual([]);
  });
}
