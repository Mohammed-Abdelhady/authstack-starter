import { ConfigService } from '@nestjs/config';
import { holdBefore, RaceGate } from '../../../test/utils/race-gate';
import {
  answerOf,
  refusalOf,
} from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import { OAuthService } from '../../auth/oauth/oauth.service';
import { SessionCookieService } from '../../auth/services/sessions/session-cookie.service';
import { Sessions } from '../../auth/services/sessions/sessions';
import { SignInCompletion } from '../../auth/services/sessions/sign-in-completion';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';
import {
  LinkedAccountsContractHarness,
  LinkedFixture,
  LinkedHarnessSource,
  linkedServicesOn,
  profileOf,
} from './linked-accounts-contract.harness-spec';

const LINKED_ELSEWHERE = {
  code: 'OAUTH_ACCOUNT_LINKED_ELSEWHERE',
  status: 409,
};
const REFUSED = { code: 'OAUTH_AUTHENTICATION_FAILED', status: 401 };
const NEW_ADDRESS = 'newcomer@example.test';

/**
 * The real service on this database's store. Nothing here signs anybody in,
 * so the sign-in and session collaborators are never reached.
 */
function providerSignInOn(
  harness: LinkedAccountsContractHarness,
): OAuthService {
  const { sync, linking } = linkedServicesOn(harness);
  return new OAuthService(
    harness.providerSignIn,
    partialMock<SignInCompletion>({}),
    sync,
    linking,
    partialMock<Sessions>({}),
    new SessionCookieService(new ConfigService({})),
  );
}

/** A provider profile on its way to an account: found, linked, stored or refused. */
export function providerSignInServiceCases(
  harness: LinkedHarnessSource,
  fixture: () => LinkedFixture,
): void {
  it('signs a provider profile in as its linked account before its address', async () => {
    const { ownerId, otherId } = fixture();
    const service = providerSignInOn(harness());
    const first = await service.findOrCreateUser(
      'google',
      profileOf('google-owner'),
    );

    // The provider now reports another account's address for that identity.
    const again = await service.findOrCreateUser(
      'google',
      profileOf('google-owner', { email: 'other@example.test' }),
    );
    const newcomer = await service.findOrCreateUser(
      'google',
      profileOf('google-new', { email: NEW_ADDRESS, name: 'New Comer' }),
    );

    expect({
      first: first.id,
      again: again.id,
      otherLinks: await harness().storedLinks(otherId),
      newcomer: {
        known: [ownerId, otherId].includes(newcomer.id),
        email: newcomer.email,
        role: newcomer.role,
      },
    }).toEqual({
      first: ownerId,
      again: ownerId,
      otherLinks: [],
      newcomer: { known: false, email: NEW_ADDRESS, role: 'user' },
    });
  });

  it('refuses a provider sign-in for a deactivated account, linked or not', async () => {
    const { ownerId, otherId } = fixture();
    const service = providerSignInOn(harness());
    await service.findOrCreateUser('google', profileOf('google-owner'));
    await harness().alterAccount(ownerId, { deleted: true });
    await harness().alterAccount(otherId, { deleted: true });

    expect({
      linked: await refusalOf(
        service.findOrCreateUser('google', profileOf('google-owner')),
      ),
      byAddress: await refusalOf(
        service.findOrCreateUser(
          'github',
          profileOf('github-other', { email: 'other@example.test' }),
        ),
      ),
      otherLinks: await harness().storedLinks(otherId),
    }).toEqual({ linked: REFUSED, byAddress: REFUSED, otherLinks: [] });
  });

  it('stores one account when two first sign-ins of one identity meet', async () => {
    const service = providerSignInOn(harness());
    const atCreate = new RaceGate();
    const restore = holdBefore(
      harness().providerSignIn,
      'createFromProvider',
      () => atCreate,
    );
    const profile = profileOf('google-twice', {
      email: NEW_ADDRESS,
      name: 'New Comer',
    });
    const racers = Promise.allSettled([
      service.findOrCreateUser('google', profile),
      service.findOrCreateUser('google', profile),
    ]);
    try {
      // Both found no identity and no address, and neither has written.
      await atCreate.reached(2);
    } finally {
      atCreate.release();
      restore();
    }

    const outcomes = (await racers).map((result) =>
      result.status === 'fulfilled' ? 'signed in' : answerOf(result.reason),
    );
    const storedId = await harness().accountIdByEmail(NEW_ADDRESS);
    expect({
      outcomes: outcomes.map((outcome) => JSON.stringify(outcome)).sort(),
      links: storedId ? await harness().storedLinks(storedId) : null,
    }).toEqual({
      outcomes: [
        JSON.stringify('signed in'),
        JSON.stringify(LINKED_ELSEWHERE),
      ].sort(),
      links: [{ provider: 'google', providerId: 'google-twice' }],
    });
  });
}
