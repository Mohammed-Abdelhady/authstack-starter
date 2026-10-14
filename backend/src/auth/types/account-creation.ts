import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';

export type AccountCreationMethod =
  (typeof ACCOUNT_CREATION_METHOD)[keyof typeof ACCOUNT_CREATION_METHOD];

export interface AccountCreationRequest {
  application: string | null;
  method: AccountCreationMethod;
}
