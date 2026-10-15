import * as bcrypt from 'bcrypt';
import { PENDING_PURPOSE } from '../../../src/auth/constants/registration';
import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { holdAddress } from '../address-claim';
import type { E2eApp } from '../e2e-app';

export interface PendingEmailChangeSeed {
  email: string;
  code: string;
  expiresAt: Date;
  addressGeneration: number;
}

export async function seedPendingEmailChange(
  e2e: E2eApp,
  seed: PendingEmailChangeSeed,
): Promise<{ _id: string; previousEmail: string }> {
  const { email, code, expiresAt, addressGeneration } = seed;
  const previousEmail = email.replace('@', '.previous@');
  const target = await e2e.state.accounts.createAccount({
    email: previousEmail,
    name: 'Target',
    isVerified: true,
    pendingEmail: email,
    addressGeneration,
  });
  await e2e.state.auth.storePendingRegistration({
    email,
    purpose: PENDING_PURPOSE.EMAIL_CHANGE,
    hashedCode: await bcrypt.hash(code, 4),
    attempts: 0,
    expiresAt,
    userId: target._id,
    addressGeneration,
  });
  await holdAddress(
    e2e.app.get(AddressLedger),
    e2e.app.get(UnitOfWorkRunner),
    e2e.clock,
    email,
    target._id,
  );
  return { ...target, previousEmail };
}
