import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { ErasureLock } from '../erasure-lock';

@Injectable()
export class DisabledErasureLock extends ErasureLock {
  assertRestorable(_unitOfWork: UnitOfWork, _userId: string): Promise<void> {
    return Promise.resolve();
  }
}
