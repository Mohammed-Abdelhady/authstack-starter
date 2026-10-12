import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { signIn } from '../authority-contract/authority-contract-support';
import {
  ADMIN_CLIENT,
  rejectionOf,
  rerunAtOnce,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import { CONTRACT_ENVIRONMENT } from '../issuance-contract/issuance-contract-harness';
import {
  accessOn,
  ApplicationsHarnessSource,
  MOBILE_CLIENT,
  nativeApplication,
  OTHER_ENVIRONMENT,
  registryOn,
} from './applications-contract-support';

const THIRTY_DAYS_MS = 2_592_000_000;
const SEVEN_DAYS_MS = 604_800_000;

const MOBILE_CLIENT_READ = {
  clientId: 'configured-mobile',
  platform: 'native',
  enabled: true,
  sessionVersion: 0,
  allowedScopes: ['api'],
  policy: { absoluteLifetimeMs: THIRTY_DAYS_MS, idleLifetimeMs: SEVEN_DAYS_MS },
  allowedOrigins: [],
  clientType: 'public',
  redirectUris: ['example-native://callback'],
  displayName: 'Configured Mobile',
};

/**
 * What an authorization request reads of a client beyond authority, and the
 * plain read of a person's grant. Neither read decides authority.
 */
export function applicationClientReadCases(
  harness: ApplicationsHarnessSource,
): void {
  /** The same client asked for on a plain read and inside a unit of work. */
  async function clientBothWays(clientId: string) {
    const registry = registryOn(harness());
    return {
      plain: await registry.lookUpClient(clientId),
      inUnitOfWork: await harness()
        .authority.issuance.runner(rerunAtOnce)
        .run((unitOfWork) => registry.findClientIn(unitOfWork, clientId)),
    };
  }

  it('answers a mobile client with its type, redirect addresses and name, on a plain read and inside a unit of work', async () => {
    await harness().seedStoredApplication(nativeApplication());

    expect(await clientBothWays(MOBILE_CLIENT)).toEqual({
      plain: MOBILE_CLIENT_READ,
      inUnitOfWork: MOBILE_CLIENT_READ,
    });
  });

  it('answers a client that has no redirect address with an empty list', async () => {
    await harness().authority.issuance.reset();
    await registryOn(harness()).seedFirstPartyApplications();

    const { plain, inUnitOfWork } = await clientBothWays(ADMIN_CLIENT);
    const fields = (client: typeof plain) => ({
      clientType: client?.clientType,
      redirectUris: client?.redirectUris,
      displayName: client?.displayName,
    });
    const expected = {
      clientType: 'confidential',
      redirectUris: [],
      displayName: 'Admin',
    };
    expect({
      plain: fields(plain),
      inUnitOfWork: fields(inUnitOfWork),
    }).toEqual({ plain: expected, inUnitOfWork: expected });
  });

  it("answers nothing for an unknown client or another environment's client", async () => {
    await harness().seedStoredApplication(
      nativeApplication({
        clientId: 'elsewhere',
        environment: OTHER_ENVIRONMENT,
      }),
    );

    expect({
      unknown: await clientBothWays('nobody'),
      elsewhere: await clientBothWays('elsewhere'),
    }).toEqual({
      unknown: { plain: null, inUnitOfWork: null },
      elsewhere: { plain: null, inUnitOfWork: null },
    });
  });

  it('answers a switched-off client without judging it', async () => {
    await harness().seedStoredApplication(nativeApplication());
    await accessOn(harness()).disableApplication(MOBILE_CLIENT);

    const switchedOff = {
      ...MOBILE_CLIENT_READ,
      enabled: false,
      sessionVersion: 1,
    };
    expect(await clientBothWays(MOBILE_CLIENT)).toEqual({
      plain: switchedOff,
      inUnitOfWork: switchedOff,
    });
  });

  it('sees an open switch-off inside the unit of work that made it, and not on a plain read until it has ended', async () => {
    await harness().seedStoredApplication(nativeApplication());
    const registry = registryOn(harness());

    const whileOpen = await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        await harness().accessStore.disableApplication(
          unitOfWork,
          CONTRACT_ENVIRONMENT,
          MOBILE_CLIENT,
        );
        return {
          inside: (await registry.findClientIn(unitOfWork, MOBILE_CLIENT))
            ?.enabled,
          plain: (await registry.lookUpClient(MOBILE_CLIENT))?.enabled,
        };
      });

    expect({
      whileOpen,
      afterItEnded: (await registry.lookUpClient(MOBILE_CLIENT))?.enabled,
    }).toEqual({
      whileOpen: { inside: false, plain: true },
      afterItEnded: false,
    });
  });

  it('reads no grant, an allowed one and a blocked one, each for its own client only', async () => {
    const { issuance } = harness().authority;
    const userId = await issuance.seedAccount();
    const access = accessOn(harness());
    const read = async () => {
      const grant = await harness().accessStore.readGrant(userId, WEB_CLIENT);
      return {
        grant: grant && {
          userId: grant.userId,
          clientId: grant.clientId,
          allowed: grant.allowed,
          sessionVersion: grant.sessionVersion,
        },
        idIsTheStoredOne:
          grant?.id === (await harness().grant(userId, WEB_CLIENT))?.id,
        allowed: await access.isGrantAllowed(userId, WEB_CLIENT),
        allowedForAdmin: await access.isGrantAllowed(userId, ADMIN_CLIENT),
      };
    };

    const none = await read();
    await signIn(harness().authority, userId);
    const allowed = await read();
    await access.blockGrant(userId, WEB_CLIENT);
    const blocked = await read();

    expect({ none, allowed, blocked }).toEqual({
      none: {
        grant: null,
        idIsTheStoredOne: true,
        allowed: false,
        allowedForAdmin: false,
      },
      allowed: {
        grant: {
          userId,
          clientId: 'web',
          allowed: true,
          sessionVersion: 0,
        },
        idIsTheStoredOne: true,
        allowed: true,
        allowedForAdmin: false,
      },
      blocked: {
        grant: {
          userId,
          clientId: 'web',
          allowed: false,
          sessionVersion: 1,
        },
        idIsTheStoredOne: true,
        allowed: false,
        allowedForAdmin: false,
      },
    });
  });

  it("refuses another database's account id on the plain grant read", async () => {
    const foreign = harness().authority.issuance.foreignAccountId();

    expect({
      store:
        (await rejectionOf(
          harness().accessStore.readGrant(foreign, WEB_CLIENT),
        )) instanceof MalformedIdError,
      service:
        (await rejectionOf(
          accessOn(harness()).isGrantAllowed(foreign, WEB_CLIENT),
        )) instanceof MalformedIdError,
    }).toEqual({ store: true, service: true });
  });
}
