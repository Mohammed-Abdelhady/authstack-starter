import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type {
  DeviceNoticeAccount,
  RememberedDevices,
} from './types/device-notice';

export abstract class DeviceNoticeStore {
  abstract take(
    work: UnitOfWork,
    userId: string,
  ): Promise<DeviceNoticeAccount | null>;
  abstract save(
    work: UnitOfWork,
    userId: string,
    devices: RememberedDevices,
  ): Promise<void>;
}
