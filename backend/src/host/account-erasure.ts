import { Injectable, type DynamicModule, type Type } from '@nestjs/common';
import { AccountErasureHook } from '../user/erasure/account-erasure-hook';
import type { ErasureSubject } from '../user/erasure/types/erasure';

/** Keeps no data of its own, so it has nothing to erase. */
@Injectable()
export class NoAccountErasureHook extends AccountErasureHook {
  readonly runsInEraseTransaction = false;

  erase(_subject: ErasureSubject): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The host product's erasure hook. Replace it with a class of the product's
 * own; read `AccountErasureHook` for what a hook must promise.
 */
export const HOST_ERASURE_HOOK: Type<AccountErasureHook> = NoAccountErasureHook;

/** Modules that provide what `HOST_ERASURE_HOOK` injects. */
export const HOST_ERASURE_HOOK_IMPORTS: Array<DynamicModule | Type> = [];
