import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore, RaceGate } from '../../race-gate';
import { outcomeOf } from '../authority-contract/authority-contract-support';
import {
  rerunAtOnce,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  accessOn,
  ApplicationsHarnessSource,
  CLIENT_ORIGIN,
  nativeApplication,
  OTHER_ENVIRONMENT,
  registryOn,
  storedApplication,
} from './applications-contract-support';

const TWO_HOURS_MS = 7_200_000;
const TEN_MINUTES_MS = 600_000;

const WEB_REGISTERED = {
  clientId: 'web',
  platform: 'web',
  enabled: true,
  sessionVersion: 0,
  allowedScopes: ['api'],
  policy: { absoluteLifetimeMs: TWO_HOURS_MS, idleLifetimeMs: TEN_MINUTES_MS },
  allowedOrigins: [],
};

export function applicationRegistryCases(
  harness: ApplicationsHarnessSource,
): void {
  let restores: Array<() => void> = [];
  let gates: RaceGate[] = [];

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  /** The same question asked both ways a caller can ask it. */
  async function requireBothWays(clientId: string) {
    const registry = registryOn(harness());
    return {
      committed: await outcomeOf(registry.requireEnabled(clientId)),
      inUnitOfWork: await outcomeOf(
        harness()
          .authority.issuance.runner(rerunAtOnce)
          .run((unitOfWork) => registry.requireEnabledIn(unitOfWork, clientId)),
      ),
    };
  }

  it('answers a registered and enabled application, on a committed read and inside a unit of work', async () => {
    expect(await requireBothWays(WEB_CLIENT)).toEqual({
      committed: WEB_REGISTERED,
      inUnitOfWork: WEB_REGISTERED,
    });
  });

  it('refuses a client that is not registered', async () => {
    expect(await requireBothWays('nobody')).toEqual({
      committed: ErrorCode.APPLICATION_NOT_FOUND,
      inUnitOfWork: ErrorCode.APPLICATION_NOT_FOUND,
    });
  });

  it('refuses a client that is switched off', async () => {
    await accessOn(harness()).disableApplication(WEB_CLIENT);

    expect(await requireBothWays(WEB_CLIENT)).toEqual({
      committed: ErrorCode.APPLICATION_DISABLED,
      inUnitOfWork: ErrorCode.APPLICATION_DISABLED,
    });
  });

  it("does not know another environment's application", async () => {
    await harness().seedStoredApplication(
      nativeApplication({
        clientId: 'elsewhere',
        environment: OTHER_ENVIRONMENT,
      }),
    );
    const registry = registryOn(harness());

    expect({
      required: await requireBothWays('elsewhere'),
      found: await registry.findByClientId('elsewhere'),
      listed: await registry.findByClientIds(['elsewhere']),
    }).toEqual({
      required: {
        committed: ErrorCode.APPLICATION_NOT_FOUND,
        inUnitOfWork: ErrorCode.APPLICATION_NOT_FOUND,
      },
      found: null,
      listed: [],
    });
  });

  it('finds a switched-off application without judging it, and nothing for an unknown client', async () => {
    await accessOn(harness()).disableApplication(WEB_CLIENT);
    const registry = registryOn(harness());

    expect({
      disabled: await registry.findByClientId(WEB_CLIENT),
      unknown: await registry.findByClientId('nobody'),
    }).toEqual({
      disabled: { ...WEB_REGISTERED, enabled: false, sessionVersion: 1 },
      unknown: null,
    });
  });

  it('lists only the registered ones among the client ids asked for', async () => {
    const registry = registryOn(harness());
    const listed = await registry.findByClientIds(['admin', 'nobody', 'web']);
    const inUnitOfWork = await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run((unitOfWork) =>
        registry.findByClientIdsIn(unitOfWork, ['nobody', 'web']),
      );

    expect({
      none: await registry.findByClientIds([]),
      listed: listed.map(({ clientId }) => clientId).sort(),
      inUnitOfWork: inUnitOfWork.map(({ clientId }) => clientId),
    }).toEqual({ none: [], listed: ['admin', 'web'], inUnitOfWork: ['web'] });
  });

  it('reads committed state: a switch-off that is still open is not seen, one that has returned is', async () => {
    const written = new RaceGate();
    gates.push(written);
    restores.push(
      holdBefore(harness().accessStore, 'appendSecurityEvent', () => written),
    );
    const registry = registryOn(harness());

    const switchingOff = accessOn(harness()).disableApplication(WEB_CLIENT);
    await written.reached(1);
    const whileOpen = await registry.findByClientId(WEB_CLIENT);
    written.release();
    await switchingOff;
    const afterReturn = await registry.findByClientId(WEB_CLIENT);

    expect({
      whileOpen: whileOpen?.enabled,
      afterReturn: afterReturn?.enabled,
      afterReturnVersion: afterReturn?.sessionVersion,
    }).toEqual({
      whileOpen: true,
      afterReturn: false,
      afterReturnVersion: 1,
    });
  });

  it('seeds the web and admin applications with their kinds, lifetimes, origin, audience and scope', async () => {
    await harness().authority.issuance.reset();

    await registryOn(harness()).seedFirstPartyApplications();

    expect(await harness().storedApplications()).toEqual([
      {
        clientId: 'admin',
        environment: 'test',
        displayName: 'Admin',
        platform: 'admin',
        clientType: 'confidential',
        enabled: true,
        redirectUris: [],
        allowedOrigins: [],
        audiences: ['api'],
        allowedScopes: ['api'],
        absoluteLifetimeMs: 28_800_000,
        idleLifetimeMs: 900_000,
        sessionVersion: 0,
      },
      {
        clientId: 'web',
        environment: 'test',
        displayName: 'Web',
        platform: 'web',
        clientType: 'public',
        enabled: true,
        redirectUris: [],
        allowedOrigins: ['https://app.example.test'],
        audiences: ['api'],
        allowedScopes: ['api'],
        absoluteLifetimeMs: 604_800_000,
        idleLifetimeMs: 1_800_000,
        sessionVersion: 0,
      },
    ]);
  });

  it('seeding again restores the configured fields and keeps what was switched off, its version and its scopes', async () => {
    await harness().authority.issuance.reset();
    await harness().seedStoredApplication({
      clientId: 'web',
      environment: 'test',
      displayName: 'Renamed by hand',
      platform: 'web',
      clientType: 'public',
      enabled: false,
      redirectUris: [],
      allowedOrigins: ['https://old.example.test'],
      audiences: ['api'],
      allowedScopes: ['api', 'profile:read'],
      absoluteLifetimeMs: 1,
      idleLifetimeMs: 1,
      sessionVersion: 4,
    });

    await registryOn(harness()).seedFirstPartyApplications();

    expect(await storedApplication(harness(), 'web')).toEqual({
      clientId: 'web',
      environment: 'test',
      displayName: 'Web',
      platform: 'web',
      clientType: 'public',
      enabled: false,
      redirectUris: [],
      allowedOrigins: ['https://app.example.test'],
      audiences: ['api'],
      allowedScopes: ['api', 'profile:read'],
      absoluteLifetimeMs: 604_800_000,
      idleLifetimeMs: 1_800_000,
      sessionVersion: 4,
    });
  });

  it('allows the client origin once on web and admin, and on nothing else', async () => {
    await harness().seedStoredApplication(nativeApplication());
    await harness().seedStoredApplication(
      nativeApplication({
        clientId: 'web',
        environment: OTHER_ENVIRONMENT,
        platform: 'web',
      }),
    );
    const registry = registryOn(harness());

    await registry.ensureClientOriginAllowed();
    await registry.ensureClientOriginAllowed();

    const origins = (await harness().storedApplications()).map(
      ({ clientId, environment, allowedOrigins }) => ({
        clientId,
        environment,
        allowedOrigins,
      }),
    );
    expect(origins).toEqual([
      { clientId: 'web', environment: 'staging', allowedOrigins: [] },
      {
        clientId: 'admin',
        environment: 'test',
        allowedOrigins: [CLIENT_ORIGIN],
      },
      {
        clientId: 'configured-mobile',
        environment: 'test',
        allowedOrigins: [],
      },
      {
        clientId: 'web',
        environment: 'test',
        allowedOrigins: [CLIENT_ORIGIN],
      },
    ]);
  });
}
