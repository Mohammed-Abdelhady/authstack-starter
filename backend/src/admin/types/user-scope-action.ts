import { USER_SCOPE_ACTION } from '../constants/user-scope-permissions';

export type UserScopeAction =
  (typeof USER_SCOPE_ACTION)[keyof typeof USER_SCOPE_ACTION];
