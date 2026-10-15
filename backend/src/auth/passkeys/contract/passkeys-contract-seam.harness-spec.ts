import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../common/persistence/persistence-errors';
import { NewPasskey } from '../stores/passkey.store';
import {
  CREDENTIAL_ID,
  NOW,
  OTHER_CREDENTIAL_ID,
  OWNER_EMAIL,
  PasskeysFixture,
  PasskeysHarnessSource,
  rejectionOf,
} from './passkeys-contract.harness-spec';

const CREDENTIAL_RULE = 'passkey.credential_id';
const CHALLENGE_RULE = 'passkey_challenge.challenge_hash';
const HASH = 'd'.repeat(64);
const HIGH_COUNTER = 4_000_000_000;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function newPasskey(userId: string, credentialId: string): NewPasskey {
  return {
    userId,
    rpId: 'localhost',
    credentialId,
    publicKey: Buffer.from([0, 255, 1, 128]),
    counter: HIGH_COUNTER,
    transports: ['usb', 'nfc'],
    backedUp: false,
    name: 'Seam key',
  };
}

/** What crosses the seam: ids as strings, bytes as bytes, refusals by type. */
export function seamCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('hands ids out and takes them back as the same strings', async () => {
    const { ownerId } = fixture();
    const { passkeys, accounts } = harness();

    const stored = await passkeys.insert(newPasskey(ownerId, CREDENTIAL_ID));

    const [facts] = await harness().storedPasskeys();
    expect({ id: stored.id, userId: stored.userId }).toEqual({
      id: facts.id,
      userId: ownerId,
    });
    expect([
      (await passkeys.findOwned(ownerId, stored.id))?.id,
      (await passkeys.findByCredentialId(CREDENTIAL_ID))?.id,
      (await passkeys.listForAccount(ownerId)).map((passkey) => passkey.id),
      (await accounts.findAccount(ownerId))?.id,
    ]).toEqual([stored.id, stored.id, [stored.id], ownerId]);
    expect(await passkeys.countForAccount(ownerId)).toBe(1);
  });

  it('stores key bytes, a counter past a signed integer, and an absent device type as they are', async () => {
    const { ownerId } = fixture();
    const { passkeys } = harness();

    const stored = await passkeys.insert(newPasskey(ownerId, CREDENTIAL_ID));
    const read = await passkeys.findByCredentialId(CREDENTIAL_ID);

    const expected = {
      id: stored.id,
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: HIGH_COUNTER,
      transports: ['usb', 'nfc'],
      deviceType: undefined,
      backedUp: false,
      name: 'Seam key',
      lastUsedAt: null,
    };
    expect(stored).toMatchObject(expected);
    expect(read).toMatchObject(expected);
    expect(
      Buffer.from(read?.publicKey ?? []).equals(Buffer.from([0, 255, 1, 128])),
    ).toBe(true);
    expect(read?.createdAt).toBeInstanceOf(Date);
    expect(await passkeys.listDescriptors(ownerId)).toEqual([
      { credentialId: CREDENTIAL_ID, transports: ['usb', 'nfc'] },
    ]);
  });

  it('reads an account as stored and the ways in it carries itself', async () => {
    const { ownerId } = fixture();
    const { accounts } = harness();
    const bareId = await harness().seedAccount({
      email: 'bare@example.test',
    });
    const linkedId = await harness().seedAccount({
      email: 'linked@example.test',
      linked: true,
    });
    await harness().setDeleted(ownerId, true);

    expect(await accounts.findAccount(ownerId)).toEqual({
      id: ownerId,
      email: OWNER_EMAIL,
      name: 'Contract Tester',
      isDeleted: true,
    });
    expect([
      await accounts.findSignInMethods(ownerId),
      await accounts.findSignInMethods(bareId),
      await accounts.findSignInMethods(linkedId),
    ]).toEqual([
      { hasPassword: true, hasLinkedAccount: false },
      { hasPassword: false, hasLinkedAccount: false },
      { hasPassword: false, hasLinkedAccount: true },
    ]);
  });

  it('answers with nothing for an id that names nothing', async () => {
    const { ownerId } = fixture();
    const { passkeys, accounts } = harness();
    const absent = harness().absentId();
    const stored = await passkeys.insert(newPasskey(ownerId, CREDENTIAL_ID));

    expect([
      await passkeys.findOwned(ownerId, absent),
      await passkeys.findOwned(absent, stored.id),
      await passkeys.findByCredentialId('bm90LXJlZ2lzdGVyZWQ'),
      await passkeys.listForAccount(absent),
      await passkeys.listDescriptors(absent),
      await passkeys.countForAccount(absent),
      await passkeys.isCredentialRegistered('bm90LXJlZ2lzdGVyZWQ'),
      await passkeys.isCredentialRegistered(CREDENTIAL_ID),
      await accounts.findAccount(absent),
      await accounts.findSignInMethods(absent),
    ]).toEqual([null, null, null, [], [], 0, false, true, null, null]);
  });

  it('refuses a malformed id before anything is read or written', async () => {
    const { ownerId } = fixture();
    const { passkeys, accounts } = harness();
    const stored = await passkeys.insert(newPasskey(ownerId, CREDENTIAL_ID));

    for (const id of ['not-an-id', '', harness().foreignId()]) {
      const refusals = await Promise.all([
        rejectionOf(passkeys.listDescriptors(id)),
        rejectionOf(passkeys.insert(newPasskey(id, OTHER_CREDENTIAL_ID))),
        rejectionOf(passkeys.listForAccount(id)),
        rejectionOf(passkeys.findOwned(id, stored.id)),
        rejectionOf(passkeys.findOwned(ownerId, id)),
        rejectionOf(passkeys.countForAccount(id)),
        rejectionOf(accounts.findAccount(id)),
        rejectionOf(accounts.findSignInMethods(id)),
      ]);

      expect(
        refusals.map((refusal) => refusal instanceof MalformedIdError),
      ).toEqual([true, true, true, true, true, true, true, true]);
    }
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  it('refuses a credential id that is already stored, by the name of the rule', async () => {
    const { ownerId, otherId } = fixture();
    const { passkeys } = harness();
    await passkeys.insert(newPasskey(ownerId, CREDENTIAL_ID));

    for (const userId of [ownerId, otherId]) {
      const refused = await rejectionOf(
        passkeys.insert(newPasskey(userId, CREDENTIAL_ID)),
      );
      expect(refused).toBeInstanceOf(UniqueConflictError);
      expect(refused).toMatchObject({ constraint: CREDENTIAL_RULE });
    }
    expect(await harness().storedPasskeys()).toMatchObject([
      { userId: ownerId, credentialId: CREDENTIAL_ID },
    ]);
  });

  it('spends a challenge once, for its own ceremony, before its expiry', async () => {
    const { challenges } = harness();
    await harness().seedChallenge({
      challengeHash: HASH,
      purpose: 'login',
      expiresAt: at(60_000),
    });
    const key = { challengeHash: HASH, purpose: 'login' as const };

    expect([
      await challenges.consume(key, at(60_000)),
      await challenges.consume(key, at(60_001)),
      await challenges.consume({ ...key, purpose: 'register' }, at(0)),
      await challenges.consume(
        { ...key, challengeHash: 'e'.repeat(64) },
        at(0),
      ),
    ]).toEqual(['refused', 'refused', 'refused', 'refused']);
    expect(await harness().storedChallenges()).toHaveLength(1);

    expect(await challenges.consume(key, at(59_999))).toBe('consumed');
    expect(await harness().storedChallenges()).toEqual([]);
    expect(await challenges.consume(key, at(0))).toBe('refused');
  });

  it('refuses a challenge that is already stored, and stores one without an account when the id is not its own', async () => {
    const { ownerId } = fixture();
    const { challenges } = harness();
    const open = (challengeHash: string, userId?: string): Promise<void> =>
      challenges.open({
        challengeHash,
        purpose: 'register',
        userId,
        expiresAt: at(60_000),
      });
    await open(HASH, ownerId);

    const refused = await rejectionOf(open(HASH, ownerId));
    await open('1'.repeat(64), 'not-an-id');
    await open('2'.repeat(64), harness().foreignId());

    expect(refused).toBeInstanceOf(UniqueConflictError);
    expect(refused).toMatchObject({ constraint: CHALLENGE_RULE });
    expect(
      (await harness().storedChallenges()).map((challenge) => ({
        challengeHash: challenge.challengeHash,
        userId: challenge.userId,
      })),
    ).toEqual([
      { challengeHash: '1'.repeat(64), userId: null },
      { challengeHash: '2'.repeat(64), userId: null },
      { challengeHash: HASH, userId: ownerId },
    ]);
  });
}
