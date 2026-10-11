import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import {
  outcomeOf,
  signIn,
  validates,
} from '../authority-contract/authority-contract-support';
import {
  ADMIN_CLIENT,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  accessOn,
  ApplicationsHarnessSource,
  eventsFor,
  nativeApplication,
  OTHER_ENVIRONMENT,
  storedApplication,
} from './applications-contract-support';

const BLOCKED = { action: 'grant_blocked', reasonCode: null };
const SWITCHED_OFF = {
  action: 'application_disabled',
  reasonCode: 'application_disabled',
};
const SWITCHED_ON = { action: 'application_enabled', reasonCode: null };

export function applicationAccessCases(
  harness: ApplicationsHarnessSource,
): void {
  /** Two people, each signed in to web, the first also to admin. */
  async function twoPeople() {
    const { issuance } = harness().authority;
    const first = await issuance.seedAccount();
    const second = await issuance.seedAccount();
    return {
      first,
      second,
      firstWeb: await signIn(harness().authority, first, 'first-web/1'),
      firstAdmin: await signIn(
        harness().authority,
        first,
        'first-admin/1',
        ADMIN_CLIENT,
      ),
      secondWeb: await signIn(harness().authority, second, 'second-web/1'),
    };
  }

  async function whoValidates(people: Awaited<ReturnType<typeof twoPeople>>) {
    return {
      firstWeb: await validates(harness().authority, people.firstWeb.token),
      firstAdmin: await validates(harness().authority, people.firstAdmin.token),
      secondWeb: await validates(harness().authority, people.secondWeb.token),
    };
  }

  function grantOf(userId: string, clientId: string) {
    return harness()
      .grant(userId, clientId)
      .then((grant) =>
        grant
          ? { allowed: grant.allowed, sessionVersion: grant.sessionVersion }
          : null,
      );
  }

  it('blocks a person who has no grant yet by creating one, blocked, at version 1', async () => {
    const userId = await harness().authority.issuance.seedAccount();

    await accessOn(harness()).blockGrant(userId, WEB_CLIENT);

    expect({
      grant: await grantOf(userId, WEB_CLIENT),
      events: await eventsFor(harness(), WEB_CLIENT),
      targets: (await harness().authority.events()).map(
        ({ targetUserId }) => targetUserId,
      ),
    }).toEqual({
      grant: { allowed: false, sessionVersion: 1 },
      events: [BLOCKED],
      targets: [userId],
    });
  });

  it("blocking a grant ends that person's sessions of that application and nothing else", async () => {
    const people = await twoPeople();

    await accessOn(harness()).blockGrant(people.first, WEB_CLIENT);

    expect({
      validates: await whoValidates(people),
      blocked: await grantOf(people.first, WEB_CLIENT),
      sameAccountOtherClient: await grantOf(people.first, ADMIN_CLIENT),
      otherAccount: await grantOf(people.second, WEB_CLIENT),
      events: await eventsFor(harness(), WEB_CLIENT),
    }).toEqual({
      validates: { firstWeb: false, firstAdmin: true, secondWeb: true },
      blocked: { allowed: false, sessionVersion: 1 },
      sameAccountOtherClient: { allowed: true, sessionVersion: 0 },
      otherAccount: { allowed: true, sessionVersion: 0 },
      events: [BLOCKED],
    });
  });

  it("blocking one application leaves the person's grant for another as it was", async () => {
    const userId = await harness().authority.issuance.seedAccount();
    const web = await signIn(harness().authority, userId);

    await accessOn(harness()).blockGrant(userId, ADMIN_CLIENT);

    expect({
      web: await grantOf(userId, WEB_CLIENT),
      admin: await grantOf(userId, ADMIN_CLIENT),
      webValidates: await validates(harness().authority, web.token),
    }).toEqual({
      web: { allowed: true, sessionVersion: 0 },
      admin: { allowed: false, sessionVersion: 1 },
      webValidates: true,
    });
  });

  it('advances the grant again, with a second event, when it is blocked twice', async () => {
    const userId = await harness().authority.issuance.seedAccount();
    await signIn(harness().authority, userId);

    await accessOn(harness()).blockGrant(userId, WEB_CLIENT);
    await accessOn(harness()).blockGrant(userId, WEB_CLIENT);

    expect({
      grant: await grantOf(userId, WEB_CLIENT),
      events: await eventsFor(harness(), WEB_CLIENT),
    }).toEqual({
      grant: { allowed: false, sessionVersion: 2 },
      events: [BLOCKED, BLOCKED],
    });
  });

  it('keeps a blocked person out of that application and lets them into another', async () => {
    const userId = await harness().authority.issuance.seedAccount();
    await accessOn(harness()).blockGrant(userId, WEB_CLIENT);

    const web = await outcomeOf(signIn(harness().authority, userId));
    const admin = await signIn(
      harness().authority,
      userId,
      'admin/1',
      ADMIN_CLIENT,
    );

    expect({
      web,
      adminValidates: await validates(harness().authority, admin.token),
      sessions: (await harness().authority.issuance.sessions(userId)).map(
        ({ clientId }) => clientId,
      ),
    }).toEqual({
      web: ErrorCode.GRANT_BLOCKED,
      adminValidates: true,
      sessions: ['admin'],
    });
  });

  it('switching an application off ends its sessions, keeps the others, and refuses sign-in', async () => {
    const people = await twoPeople();

    await accessOn(harness()).disableApplication(WEB_CLIENT);

    const web = await storedApplication(harness(), WEB_CLIENT);
    const admin = await storedApplication(harness(), ADMIN_CLIENT);
    expect({
      validates: await whoValidates(people),
      web: { enabled: web?.enabled, sessionVersion: web?.sessionVersion },
      admin: {
        enabled: admin?.enabled,
        sessionVersion: admin?.sessionVersion,
      },
      signIn: await outcomeOf(signIn(harness().authority, people.second)),
      events: await eventsFor(harness(), WEB_CLIENT),
    }).toEqual({
      validates: { firstWeb: false, firstAdmin: true, secondWeb: false },
      web: { enabled: false, sessionVersion: 1 },
      admin: { enabled: true, sessionVersion: 0 },
      signIn: ErrorCode.APPLICATION_DISABLED,
      events: [SWITCHED_OFF],
    });
  });

  it('switching it back on keeps its version: earlier sessions stay ended and a new sign-in holds', async () => {
    const people = await twoPeople();
    await accessOn(harness()).disableApplication(WEB_CLIENT);

    await accessOn(harness()).enableApplication(WEB_CLIENT);

    const web = await storedApplication(harness(), WEB_CLIENT);
    const fresh = await signIn(harness().authority, people.second, 'fresh/1');
    expect({
      web: { enabled: web?.enabled, sessionVersion: web?.sessionVersion },
      earlier: await whoValidates(people),
      fresh: await validates(harness().authority, fresh.token),
      events: await eventsFor(harness(), WEB_CLIENT),
    }).toEqual({
      web: { enabled: true, sessionVersion: 1 },
      earlier: { firstWeb: false, firstAdmin: true, secondWeb: false },
      fresh: true,
      events: [SWITCHED_OFF, SWITCHED_ON],
    });
  });

  it('refuses to switch an application that is not registered, and records nothing', async () => {
    expect({
      off: await outcomeOf(accessOn(harness()).disableApplication('nobody')),
      on: await outcomeOf(accessOn(harness()).enableApplication('nobody')),
      events: await harness().authority.events(),
    }).toEqual({
      off: ErrorCode.APPLICATION_NOT_FOUND,
      on: ErrorCode.APPLICATION_NOT_FOUND,
      events: [],
    });
  });

  it("leaves another environment's application of the same client id as it was", async () => {
    await harness().seedStoredApplication(
      nativeApplication({
        clientId: WEB_CLIENT,
        environment: OTHER_ENVIRONMENT,
        platform: 'web',
        sessionVersion: 6,
      }),
    );

    await accessOn(harness()).disableApplication(WEB_CLIENT);

    const elsewhere = await storedApplication(
      harness(),
      WEB_CLIENT,
      OTHER_ENVIRONMENT,
    );
    expect({
      enabled: elsewhere?.enabled,
      sessionVersion: elsewhere?.sessionVersion,
    }).toEqual({ enabled: true, sessionVersion: 6 });
  });
}
