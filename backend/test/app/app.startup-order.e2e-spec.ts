import { StorageStartup } from '../../src/common/persistence/storage-startup';
import { RoleSweepBootstrapService } from '../../src/role/services/bootstrap/role-sweep-bootstrap.service';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

type AsyncStep = (...args: never[]) => Promise<unknown>;

/**
 * Lets the real step run and writes down when it started and when it ended,
 * so the order of the steps can be read back.
 */
function recordStep<Owner extends object>(
  order: string[],
  owner: Owner,
  method: keyof Owner & string,
  label: string,
): void {
  const real: unknown = Reflect.get(owner, method);
  if (typeof real !== 'function') {
    throw new Error(`${method} is not a method of the recorded class`);
  }
  Reflect.set(
    owner,
    method,
    async function (
      this: Owner,
      ...args: Parameters<AsyncStep>
    ): Promise<unknown> {
      order.push(`${label}: start`);
      const result: unknown = await Reflect.apply(real, this, args);
      order.push(`${label}: end`);
      return result;
    },
  );
  restores.push(() => Reflect.set(owner, method, real));
}

const restores: Array<() => void> = [];
/** Entries the boot itself writes: four timed steps and the role repair. */
const BOOT_STEPS = 9;

/**
 * The store is made ready before anything reads or writes at boot. The steps
 * that were already there keep their order after it: the first applications,
 * the client origin, the role repair, and the configured mobile applications.
 */
describe('the order the application starts in', () => {
  let e2e: E2eApp | undefined;
  const order: string[] = [];
  let atBoot: string[] = [];

  beforeAll(async () => {
    recordStep(
      order,
      ApplicationRegistry.prototype,
      'seedFirstPartyApplications',
      'seed the first applications',
    );
    recordStep(
      order,
      ApplicationRegistry.prototype,
      'ensureClientOriginAllowed',
      'allow the client origin',
    );
    recordStep(
      order,
      ApplicationRegistry.prototype,
      'reconcileNativeApplications',
      'reconcile mobile applications',
    );
    const repair: unknown = Reflect.get(
      RoleSweepBootstrapService.prototype,
      'onApplicationBootstrap',
    );
    if (typeof repair !== 'function') {
      throw new Error('the role repair has no bootstrap hook');
    }
    Reflect.set(
      RoleSweepBootstrapService.prototype,
      'onApplicationBootstrap',
      function (this: RoleSweepBootstrapService): void {
        order.push('repair roles');
        Reflect.apply(repair, this, []);
      },
    );
    restores.push(() =>
      Reflect.set(
        RoleSweepBootstrapService.prototype,
        'onApplicationBootstrap',
        repair,
      ),
    );

    // The start-up the application was given for its database, before it runs.
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        recordStep(
          order,
          app.get(StorageStartup, { strict: false }),
          'prepare',
          'prepare storage',
        ),
    });
    // The harness resets its data after the boot and repeats some steps then.
    atBoot = order.slice(0, BOOT_STEPS);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    for (const restore of restores.splice(0)) restore();
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('prepares the store first and keeps every later step in its place', () => {
    expect(atBoot).toEqual([
      'prepare storage: start',
      'prepare storage: end',
      'seed the first applications: start',
      'seed the first applications: end',
      'allow the client origin: start',
      'allow the client origin: end',
      'repair roles',
      'reconcile mobile applications: start',
      'reconcile mobile applications: end',
    ]);
  });
});
