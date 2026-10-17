import type { Type } from '@nestjs/common';
import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { StaffGuard } from '../auth/guards/staff.guard';
import { RoleModule } from '../role/role.module';
import { AdminModule } from './admin.module';

function isClass(value: unknown): value is Type<unknown> {
  return typeof value === 'function';
}

function controllersOf(module: Type<unknown>): Type<unknown>[] {
  const controllers: unknown = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    module,
  );
  return Array.isArray(controllers) ? controllers.filter(isClass) : [];
}

function staffGuarded(controller: Type<unknown>): boolean {
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, controller);
  return Array.isArray(guards) && guards.includes(StaffGuard);
}

// Failure: a staff controller answers a web session or a mobile token because it lacks the staff guard.
describe('staff route guards', () => {
  it.each([
    ['admin', AdminModule],
    ['role', RoleModule],
  ])('guards every %s controller with the staff guard', (_name, module) => {
    const controllers = controllersOf(module);

    expect(controllers.length).toBeGreaterThan(0);
    expect(
      controllers
        .filter((controller) => !staffGuarded(controller))
        .map(({ name }) => name),
    ).toEqual([]);
  });
});
