import { storedLocale } from '../../../common/constants/locales';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { DeviceNoticeStore } from '../../notices/device-notice.store';
import type { RememberedDevices } from '../../notices/types/device-notice';

export class PostgresDeviceNoticeStore extends DeviceNoticeStore {
  async take(work: UnitOfWork, userId: string) {
    const user = await postgresTransactionOf(work)
      .selectFrom('users')
      .select([
        'email',
        'locale',
        'is_verified',
        'issuance_fence',
        'sign_in_devices',
      ])
      .where('id', '=', userId)
      .where('is_deleted', '=', false)
      .forUpdate()
      .executeTakeFirst();
    return user?.email
      ? {
          email: user.email,
          locale: storedLocale(user.locale),
          verified: user.is_verified,
          signIns: user.issuance_fence,
          devices: user.sign_in_devices,
        }
      : null;
  }

  async save(
    work: UnitOfWork,
    userId: string,
    devices: RememberedDevices,
  ): Promise<void> {
    await postgresTransactionOf(work)
      .updateTable('users')
      .set({ sign_in_devices: JSON.stringify(devices) })
      .where('id', '=', userId)
      .execute();
  }
}
