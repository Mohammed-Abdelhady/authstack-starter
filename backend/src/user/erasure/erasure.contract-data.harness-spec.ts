import type {
  ErasureHarness,
  ErasureAccount,
} from './erasure.contract.harness-spec';
const CHILD_COUNTS = {
  sessions: 1,
  credentials: 1,
  authorization: 1,
  grants: 1,
  linked: 1,
  passkeys: 1, // feature:passkeys
  passkeyChallenges: 2, // feature:passkeys
  twoFactor: 1, // feature:totp
  tickets: 1, // feature:oauth-core
  attempts: 2,
  claims: 1,
  registrations: 2,
  resets: 2,
  counters: 2,
  magicLinks: 2, // feature:magic-link
  emailCodes: 2, // feature:email-code
  users: 1,
};
const EMPTY_COUNTS = {
  sessions: 0,
  credentials: 0,
  authorization: 0,
  grants: 0,
  linked: 0,
  passkeys: 0, // feature:passkeys
  passkeyChallenges: 0, // feature:passkeys
  twoFactor: 0, // feature:totp
  tickets: 0, // feature:oauth-core
  attempts: 0,
  claims: 0,
  registrations: 0,
  resets: 0,
  counters: 0,
  magicLinks: 0, // feature:magic-link
  emailCodes: 0, // feature:email-code
  users: 0,
};

export function describeErasureDataContract(
  get: () => ErasureHarness,
  past: Date,
): void {
  async function erase(subject: ErasureAccount) {
    return get().runner.run(async (u) => {
      const read = await get().eraser.readFactsIn(u, subject.id);
      if (!read) throw new Error('Account facts were missing');
      expect(read.onAccount).toEqual({
        address: subject.email,
        pendingAddress: subject.pendingEmail,
      });
      expect(read.sessionIds).toHaveLength(1);
      expect(read.identities).toEqual([
        { provider: 'google', providerId: subject.email },
      ]);
      // Both, as the worker passes them while the pending claim is live.
      const { onAccount: _onAccount, ...facts } = read;
      await get().eraser.eraseIn(u, {
        ...facts,
        addresses: [subject.email, subject.pendingEmail],
      });
    });
  }

  it('erases every owned row and address variant while retaining another account and redacting actor and target events', async () => {
    const h = get();
    const mine = await h.seedAccount('erase@example.test', true, past);
    const theirs = await h.seedAccount('other@example.test', true, past);
    await h.seedChildren(mine);
    await h.seedChildren(theirs);
    expect(await h.counts(mine)).toEqual(CHILD_COUNTS);
    expect(await h.counts(theirs)).toEqual(CHILD_COUNTS);
    await erase(mine);
    expect(await h.counts(mine)).toEqual(EMPTY_COUNTS);
    expect(await h.counts(theirs)).toEqual(CHILD_COUNTS);
    expect(await h.events()).toEqual(
      expect.arrayContaining([
        {
          eventId: `${mine.id}:actor`,
          actorId: mine.id,
          targetUserId: 'unrelated',
          action: 'account.updated',
          details: { changedFields: ['role'] },
        },
        {
          eventId: `${mine.id}:target`,
          actorId: 'unrelated',
          targetUserId: mine.id,
          action: 'account.updated',
          details: { changedFields: ['role'] },
        },
        {
          eventId: `${theirs.id}:actor`,
          actorId: theirs.id,
          targetUserId: 'unrelated',
          action: 'account.updated',
          details: {
            name: 'Personal',
            email: theirs.email,
            changedFields: ['role'],
          },
        },
        {
          eventId: `${theirs.id}:target`,
          actorId: 'unrelated',
          targetUserId: theirs.id,
          action: 'account.updated',
          details: {
            name: 'Personal',
            email: theirs.email,
            changedFields: ['role'],
          },
        },
      ]),
    );
    expect(
      await h.runner.run((u) => h.eraser.readFactsIn(u, mine.id)),
    ).toBeNull();
  });
  it('releases the erased address for a new account with a different id', async () => {
    const h = get();
    const mine = await h.seedAccount('erase@example.test', true, past);
    await h.seedChildren(mine);
    await erase(mine);
    const replacement = await h.seedAccount(mine.email);
    expect(replacement.id).not.toBe(mine.id);
    expect(await h.schedule(replacement.id)).toBeNull();
  });
}
