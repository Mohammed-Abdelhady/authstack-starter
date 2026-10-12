import { Module } from '@nestjs/common';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { RoleSweepBootstrapService } from './services/bootstrap/role-sweep-bootstrap.service';
import { RoleEditService } from './services/edit/role-edit.service';
import { RoleHierarchyService } from './services/role-hierarchy.service';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { SessionModule } from '../session/session.module';
import { RoleChangeStore } from './stores/role-change.store';
import { RoleSweepStore } from './stores/role-sweep.store';
import {
  ROLE_PERSISTENCE_IMPORTS,
  ROLE_PERSISTENCE_PROVIDERS,
} from './persistence/role-persistence';

@Module({
  imports: [
    ...ROLE_PERSISTENCE_IMPORTS,
    AuthModule, // Session services used by the global AuthGuard
    CommonModule, // Required for RolesGuard
    SessionModule, // Security events and the unit of work for role edits
  ],
  controllers: [RoleController],
  providers: [
    RoleService,
    RoleEditService,
    RoleHierarchyService,
    RoleSweepBootstrapService,
    ...ROLE_PERSISTENCE_PROVIDERS,
  ],
  exports: [RoleService, RoleHierarchyService, RoleChangeStore, RoleSweepStore],
})
export class RoleModule {}
