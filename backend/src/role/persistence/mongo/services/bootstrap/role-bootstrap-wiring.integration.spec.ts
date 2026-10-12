import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { bootE2eApp, E2eApp } from '../../../../../../test/utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import { Role, RoleDocument } from '../../schemas/role.schema';
import {
  User,
  UserDocument,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../../session/persistence/mongo/schemas/security-event.schema';
import { RoleSweepBootstrapService } from '../../../../services/bootstrap/role-sweep-bootstrap.service';
import { finishBootstrap } from '../../../../services/bootstrap/role-bootstrap.harness-spec';

describe('registered role startup lifecycle', () => {
  let h: E2eApp;
  beforeAll(async () => {
    h = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await h?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  it('repairs holders through the application registered bootstrap provider', async () => {
    const roles = h.app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const users = h.app.get<Model<UserDocument>>(getModelToken(User.name));
    const events = h.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    const lifecycle = h.app.get(RoleSweepBootstrapService);
    await lifecycle.onApplicationShutdown();
    const roleId = new Types.ObjectId('000000000000000000000030');
    await roles.create({
      _id: roleId,
      name: 'Wiring Lead',
      slug: 'wiring-lead',
      permissions: [],
      pendingHolderSweeps: [
        {
          roleId,
          previousSlug: 'wiring-editor',
          actorId: '000000000000000000000020',
        },
      ],
    });
    const user = await users.create({
      email: 'bootstrap-wiring@example.test',
      name: 'Holder',
      role: 'wiring-editor',
      isVerified: true,
      sessionVersion: 0,
    });
    await finishBootstrap([lifecycle]);
    expect((await users.findById(user._id))?.role).toBe('wiring-lead');
    expect((await users.findById(user._id))?.sessionVersion).toBe(1);
    expect(
      await events.countDocuments({ targetUserId: user._id.toString() }),
    ).toBe(1);
    expect((await roles.findById(roleId))?.pendingHolderSweeps).toEqual([]);
  });
});
