import {
  ADMIN_CLIENT,
  rerunAtOnce,
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
  signUp: 'open',
  requirePasskey: false,
  signInMethods: null,
  policyVersion: 0,
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
}
