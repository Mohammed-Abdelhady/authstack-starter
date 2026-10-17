import type { Request } from 'express';
import { ADMIN_CLIENT_ID, WEB_CLIENT_ID } from '../../constants/client-ids';
import type { BrowserSignInConfiguration } from '../../../config/types/host-policy.type';

export type BrowserApplicationId =
  typeof WEB_CLIENT_ID | typeof ADMIN_CLIENT_ID;

export interface BrowserApplicationConfiguration {
  readonly clientId: BrowserApplicationId;
  readonly returnBase: string;
  readonly origin: string;
  readonly signIn: BrowserSignInConfiguration | undefined;
}

export interface BrowserApplication extends BrowserApplicationConfiguration {
  readonly enabled: boolean;
}

export type BrowserApplicationEnabledReader = (
  clientId: BrowserApplicationId,
) => Promise<boolean>;

export type BrowserCeremonyReader = (
  request: Request,
) => Promise<BrowserApplicationId | undefined>;
