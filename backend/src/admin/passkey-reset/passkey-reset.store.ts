// feature:passkeys:start
import type { UnitOfWork } from '../../common/persistence/unit-of-work';

export abstract class PasskeyResetStore {
  abstract removeAll(work: UnitOfWork, userId: string): Promise<void>;
}
// feature:passkeys:end
