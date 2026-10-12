import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import {
  ABORT_AFTER_EVENT,
  failAfter,
  outcomeOf,
  signIn,
  validates,
} from '../authority-contract/authority-contract-support';
import {
  ADMIN_CLIENT,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import { ApplicationsContractHarness } from './applications-contract-harness';
import {
  accessOn,
  ApplicationsHarnessSource,
  storedApplication,
} from './applications-contract-support';

interface Workflow {
  name: string;
  run: (harness: ApplicationsContractHarness, userId: string) => Promise<void>;
}

/**
 * Each starts from one person signed in to web, with an allowed web grant, no
 * admin grant, web enabled and admin switched off at version 1.
 */
const WORKFLOWS: Workflow[] = [
  {
    name: 'blocking a person who has no grant yet',
    run: (harness, userId) =>
      accessOn(harness).blockGrant(userId, ADMIN_CLIENT),
  },
  {
    name: 'blocking a grant',
    run: (harness, userId) => accessOn(harness).blockGrant(userId, WEB_CLIENT),
  },
  {
    name: 'switching an application off',
    run: (harness) => accessOn(harness).disableApplication(WEB_CLIENT),
  },
  {
    name: 'switching an application on',
    run: (harness) => accessOn(harness).enableApplication(ADMIN_CLIENT),
  },
];

const NOTHING_STORED = {
  outcome: ErrorCode.AUTHORITY_UNAVAILABLE,
  webGrant: { allowed: true, sessionVersion: 0 },
  adminGrant: null,
  web: { enabled: true, sessionVersion: 0 },
  admin: { enabled: false, sessionVersion: 1 },
  events: ['session_issued', 'application_disabled'],
  sessionValidates: true,
};

export function applicationAtomicityCases(
  harness: ApplicationsHarnessSource,
): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  async function start() {
    const userId = await harness().authority.issuance.seedAccount();
    const signedIn = await signIn(harness().authority, userId);
    await accessOn(harness()).disableApplication(ADMIN_CLIENT);
    return { userId, signedIn };
  }

  async function observed(
    outcome: unknown,
    started: Awaited<ReturnType<typeof start>>,
  ) {
    const grant = async (clientId: string) => {
      const stored = await harness().grant(started.userId, clientId);
      return stored
        ? { allowed: stored.allowed, sessionVersion: stored.sessionVersion }
        : null;
    };
    const application = async (clientId: string) => {
      const stored = await storedApplication(harness(), clientId);
      return {
        enabled: stored?.enabled,
        sessionVersion: stored?.sessionVersion,
      };
    };
    return {
      outcome,
      webGrant: await grant(WEB_CLIENT),
      adminGrant: await grant(ADMIN_CLIENT),
      web: await application(WEB_CLIENT),
      admin: await application(ADMIN_CLIENT),
      events: (await harness().authority.events()).map(({ action }) => action),
      sessionValidates: await validates(
        harness().authority,
        started.signedIn.token,
      ),
    };
  }

  it.each(WORKFLOWS)(
    'stores nothing of $name when the database refuses its event',
    async (workflow) => {
      const started = await start();
      const restore = await harness().authority.issuance.refuseSecurityEvents();
      restores.push(restore);

      const outcome = await outcomeOf(workflow.run(harness(), started.userId));
      restore();

      expect(await observed(outcome, started)).toEqual(NOTHING_STORED);
    },
  );

  it.each(WORKFLOWS)(
    'stores nothing of $name, the event included, when the work is aborted after the event',
    async (workflow) => {
      const started = await start();
      const restore = failAfter(
        harness().accessStore,
        'appendSecurityEvent',
        new Error(ABORT_AFTER_EVENT),
      );
      restores.push(restore);

      const outcome = await outcomeOf(workflow.run(harness(), started.userId));
      restore();

      expect(await observed(outcome, started)).toEqual(NOTHING_STORED);
    },
  );
}
