import { Test } from '@nestjs/testing';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { FreshProofGate } from '../../auth/proof/fresh-proof-gate';
import { freshProofRefusal } from '../../auth/proof/utils/fresh-proof-refusal';
import { FreshProofCheck } from '../../auth/contracts/fresh-proof';
import { SessionFreshProofCheck } from '../../auth/contracts/defaults/session-fresh-proof-check';
import { NativeMethodsService } from '../../auth/native/services/native-methods.service';
import { OAuthRegistryService } from '../../auth/oauth/oauth-registry.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { CREDENTIAL_PURPOSE } from '../../session/constants/credential-purpose';
import { InPlaceRunner } from '../erasure/testing/erasure-memory.harness-spec';
import { AccountLinkingService } from '../services/account-linking.service';
import { ProfileSyncService } from '../services/profile-sync.service';
import { ProviderLinkService } from './provider-link.service';
import { ProviderLinkTicketStore } from './stores/provider-link-ticket.store';
import type {
  NewProviderLinkTicket,
  ProviderLinkCaller,
  ProviderLinkTicket,
} from './types/provider-link';

/** The ticket rule in memory: spent once, by the account and session it names. */
class MemoryTickets extends ProviderLinkTicketStore {
  readonly opened: (NewProviderLinkTicket & { spent: boolean })[] = [];

  open(ticket: NewProviderLinkTicket): Promise<void> {
    this.opened.push({ ...ticket, spent: false });
    return Promise.resolve();
  }

  spend(
    ticketHash: string,
    owner: { userId: string; sessionId: string },
    now: Date,
  ): Promise<ProviderLinkTicket | null> {
    const ticket = this.opened.find(
      (candidate) =>
        candidate.ticketHash === ticketHash &&
        candidate.userId === owner.userId &&
        candidate.sessionId === owner.sessionId &&
        !candidate.spent &&
        candidate.expiresAt > now,
    );
    if (!ticket) return Promise.resolve(null);
    ticket.spent = true;
    return Promise.resolve(ticket);
  }
}

const APP_CALLER: ProviderLinkCaller = {
  userId: 'account-1',
  sessionId: 'session-1',
  clientId: 'mobile-app',
  signedInAt: new Date(TEST_NOW.getTime() - 60_000),
  credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
};
/** Signed in a minute ago; the catalogue stub offers it Google like the app. */
const CALLER: ProviderLinkCaller = {
  ...APP_CALLER,
  credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
};
const GOOGLE = {
  id: 'google',
  displayName: 'Google',
  mode: 'googleIdentityToken',
  sdk: { kind: 'google', webClientId: 'web.apps.googleusercontent.com' },
};
/** Google's account with an address the app account does not have. */
const PROFILE = {
  providerId: 'google-sub-1',
  email: 'other@gmail.com',
  emailVerified: true,
  name: 'Ada',
};

async function setUp() {
  const tickets = new MemoryTickets();
  const linking = {
    getLinkedProviders: jest.fn(() => Promise.resolve(['email'])),
    linkProvider: jest.fn(() => Promise.resolve({})),
  };
  const verifyNativeCredential = jest.fn(() => Promise.resolve(PROFILE));
  const module = await Test.createTestingModule({
    providers: [
      ProviderLinkService,
      { provide: ProviderLinkTicketStore, useValue: tickets },
      { provide: AccountLinkingService, useValue: linking },
      {
        provide: ProfileSyncService,
        useValue: { syncProfileFromProvider: jest.fn() },
      },
      { provide: FreshProofCheck, useClass: SessionFreshProofCheck },
      {
        provide: FreshProofGate,
        inject: [FreshProofCheck],
        useFactory: (check: FreshProofCheck): FreshProofGate => ({
          assertFresh: async (work, session, requirement) => {
            if (
              !(await check.isFresh(work, {
                ...session,
                requirement,
                requirePasskey: false,
              }))
            )
              throw freshProofRefusal({ passkeyRelyingParty: null });
          },
        }),
      },
      { provide: UnitOfWorkRunner, useClass: InPlaceRunner },
      { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
      {
        provide: NativeMethodsService,
        useValue: {
          forAccountLink: () => Promise.resolve([GOOGLE]),
        },
      },
      {
        provide: OAuthRegistryService,
        useValue: { getEnabled: () => ({ verifyNativeCredential }) },
      },
    ],
  }).compile();
  const service = module.get(ProviderLinkService);
  return { service, tickets, linking, verifyNativeCredential };
}

function proof(nonceDigest: string) {
  return {
    kind: 'googleIdentityToken',
    identityToken: 'id-token',
    nonceDigest,
  };
}

describe('linking a provider from an app', () => {
  it('refuses to start without a sign-in from the last five minutes, and opens no link', async () => {
    const { service, tickets } = await setUp();
    const stale = {
      ...CALLER,
      signedInAt: new Date(TEST_NOW.getTime() - 5 * 60_000 - 1),
    };

    await expect(service.start(stale, 'google')).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });
    expect(tickets.opened).toEqual([]);
  });

  it('accepts a mobile session with recent actual authentication', async () => {
    const { service, tickets } = await setUp();

    await expect(service.start(APP_CALLER, 'google')).resolves.toMatchObject({
      linkId: expect.any(String),
    });
    expect(tickets.opened).toHaveLength(1);
  });

  it('refuses a proof made for another nonce, and links nothing', async () => {
    const { service, linking, verifyNativeCredential } = await setUp();
    const start = await service.start(CALLER, 'google');

    await expect(
      service.finish(CALLER, start.linkId, proof('0'.repeat(64))),
    ).rejects.toMatchObject({ code: ErrorCode.OAUTH_STATE_INVALID });
    expect(verifyNativeCredential).not.toHaveBeenCalled();
    expect(linking.linkProvider).not.toHaveBeenCalled();
  });

  it("refuses another session's link, and links nothing", async () => {
    const { service, linking } = await setUp();
    const start = await service.start(CALLER, 'google');

    await expect(
      service.finish(
        { ...CALLER, sessionId: 'session-2' },
        start.linkId,
        proof(start.nonceDigest),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.OAUTH_STATE_INVALID });
    expect(linking.linkProvider).not.toHaveBeenCalled();
  });

  it('links the identity the proof names to the caller, whatever address the provider reports', async () => {
    const { service, linking, verifyNativeCredential } = await setUp();
    const start = await service.start(CALLER, 'google');

    await service.finish(CALLER, start.linkId, proof(start.nonceDigest));

    expect(verifyNativeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ nonceDigest: start.nonceDigest }),
    );
    expect(linking.linkProvider).toHaveBeenCalledWith(
      'account-1',
      'google',
      PROFILE,
      'any',
    );
    await expect(
      service.finish(CALLER, start.linkId, proof(start.nonceDigest)),
    ).rejects.toMatchObject({ code: ErrorCode.OAUTH_STATE_INVALID });
  });
});
