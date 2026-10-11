import {
  MalformedIdError,
  RetryableAbortError,
  UniqueConflictError,
} from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { outcomeOf } from '../authority-contract/authority-contract-support';
import {
  rejectionOf,
  rerunAtOnce,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  accessOn,
  ApplicationsHarnessSource,
  storedApplication,
} from './applications-contract-support';

/** The seam itself: ids, the unique rule, and each write's own outcome. */
export function applicationStoreCases(
  harness: ApplicationsHarnessSource,
): void {
  const store = () => harness().accessStore;
  const run = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> =>
    harness().authority.issuance.runner(rerunAtOnce).run(work);

  it('hands a grant id out and takes the same string back', async () => {
    const userId = await harness().authority.issuance.seedAccount();

    const created = await run((unitOfWork) =>
      store().createBlockedGrant(unitOfWork, {
        userId,
        clientId: WEB_CLIENT,
        sessionVersion: 1,
      }),
    );
    const taken = await run(async (unitOfWork) => {
      const grant = await store().takeGrantForChange(
        unitOfWork,
        userId,
        WEB_CLIENT,
      );
      if (grant) {
        await store().blockGrant(unitOfWork, grant.id);
      }
      return grant;
    });

    const stored = await harness().grant(userId, WEB_CLIENT);
    expect({
      created,
      taken,
      storedId: stored?.id === created.id,
      storedVersion: stored?.sessionVersion,
    }).toEqual({
      created: {
        id: created.id,
        userId,
        clientId: 'web',
        allowed: false,
        sessionVersion: 1,
      },
      taken: {
        id: created.id,
        userId,
        clientId: 'web',
        allowed: false,
        sessionVersion: 1,
      },
      storedId: true,
      storedVersion: 2,
    });
  });

  it('answers nothing for a person who has no grant for the client', async () => {
    const userId = await harness().authority.issuance.seedAccount();

    expect(
      await run((unitOfWork) =>
        store().takeGrantForChange(unitOfWork, userId, WEB_CLIENT),
      ),
    ).toBeNull();
  });

  it('refuses a second grant for the same person and client as a named unique conflict', async () => {
    const userId = await harness().authority.issuance.seedAccount();
    const grant = { userId, clientId: WEB_CLIENT, sessionVersion: 1 };
    await run((unitOfWork) => store().createBlockedGrant(unitOfWork, grant));

    const refused = await rejectionOf(
      run((unitOfWork) => store().createBlockedGrant(unitOfWork, grant)),
    );

    expect({
      shared: refused instanceof UniqueConflictError,
      constraint:
        refused instanceof UniqueConflictError ? refused.constraint : null,
      stored: (await harness().authority.issuance.grants(userId)).length,
    }).toEqual({ shared: true, constraint: 'grant.user_client', stored: 1 });
  });

  it("refuses another database's id as malformed, wherever an id goes in", async () => {
    const foreignAccount = harness().authority.issuance.foreignAccountId();
    const refusals = {
      take: await rejectionOf(
        run((unitOfWork) =>
          store().takeGrantForChange(unitOfWork, foreignAccount, WEB_CLIENT),
        ),
      ),
      create: await rejectionOf(
        run((unitOfWork) =>
          store().createBlockedGrant(unitOfWork, {
            userId: foreignAccount,
            clientId: WEB_CLIENT,
            sessionVersion: 1,
          }),
        ),
      ),
      block: await rejectionOf(
        run((unitOfWork) =>
          store().blockGrant(unitOfWork, harness().foreignGrantId()),
        ),
      ),
    };

    expect({
      take: refusals.take instanceof MalformedIdError,
      create: refusals.create instanceof MalformedIdError,
      block: refusals.block instanceof MalformedIdError,
      throughTheService: await outcomeOf(
        accessOn(harness()).blockGrant(foreignAccount, WEB_CLIENT),
      ),
      events: await harness().authority.events(),
    }).toEqual({
      take: true,
      create: true,
      block: true,
      throughTheService: ErrorCode.AUTHORITY_UNAVAILABLE,
      events: [],
    });
  });

  it('leaves every grant as it was when the id names none', async () => {
    const userId = await harness().authority.issuance.seedAccount();
    await accessOn(harness()).blockGrant(userId, WEB_CLIENT);

    await run((unitOfWork) =>
      store().blockGrant(unitOfWork, harness().absentGrantId()),
    );

    const stored = await harness().grant(userId, WEB_CLIENT);
    expect({
      allowed: stored?.allowed,
      sessionVersion: stored?.sessionVersion,
    }).toEqual({ allowed: false, sessionVersion: 1 });
  });

  it('says whether an application was switched or is not registered', async () => {
    const outcomes = await run(async (unitOfWork) => ({
      off: await store().disableApplication(unitOfWork, 'test', WEB_CLIENT),
      on: await store().enableApplication(unitOfWork, 'test', WEB_CLIENT),
      offUnknown: await store().disableApplication(
        unitOfWork,
        'test',
        'nobody',
      ),
      onUnknown: await store().enableApplication(unitOfWork, 'test', 'nobody'),
      offElsewhere: await store().disableApplication(
        unitOfWork,
        'staging',
        WEB_CLIENT,
      ),
      onElsewhere: await store().enableApplication(
        unitOfWork,
        'staging',
        WEB_CLIENT,
      ),
    }));

    expect(outcomes).toEqual({
      off: 'switched',
      on: 'switched',
      offUnknown: 'not_registered',
      onUnknown: 'not_registered',
      offElsewhere: 'not_registered',
      onElsewhere: 'not_registered',
    });
  });

  it('refuses, as a retryable abort, to store a registration over an application of another kind', async () => {
    const pauses: number[] = [];
    const refused = await rejectionOf(
      harness()
        .authority.issuance.runner((failedAttempts) => {
          pauses.push(failedAttempts);
          return Promise.resolve();
        })
        .run((unitOfWork) =>
          harness().registryStore.storeNativeRegistration(unitOfWork, {
            clientId: 'web',
            environment: 'test',
            displayName: 'Configured Mobile',
            redirectUris: ['example-native://callback'],
            allowedScopes: ['api'],
            audiences: ['api'],
            policy: { absoluteLifetimeMs: 1000, idleLifetimeMs: 100 },
            endsSessions: true,
          }),
        ),
    );

    const web = await storedApplication(harness(), 'web');
    expect({
      retryable: refused instanceof RetryableAbortError,
      pauses,
      web: {
        platform: web?.platform,
        displayName: web?.displayName,
        sessionVersion: web?.sessionVersion,
      },
    }).toEqual({
      retryable: true,
      pauses: [1, 2],
      web: { platform: 'web', displayName: 'web', sessionVersion: 0 },
    });
  });
}
