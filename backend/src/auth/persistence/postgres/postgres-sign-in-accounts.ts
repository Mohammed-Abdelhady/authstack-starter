import { EMAIL_PROVIDER } from '../../../common/constants/oauth-providers';
import { SignInAccount } from '../../utils/authenticated-user.util';

/** What the last step of a sign-in needs of an account row. */
export const SIGN_IN_COLUMNS = [
  'id',
  'email',
  'name',
  'role',
  'permissions',
  'auth_provider',
  'is_verified',
] as const;

export interface SignInRow {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  permissions: string[];
  auth_provider: string | null;
  is_verified: boolean;
}

/** The account a sign-in finishes with, as its row was read. */
export function toSignInAccount(
  row: SignInRow,
  twoFactorEnabled = false, // feature:totp
): SignInAccount {
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name ?? '',
    role: row.role,
    permissions: [...row.permissions],
    authProvider: row.auth_provider ?? EMAIL_PROVIDER,
    isVerified: row.is_verified,
    twoFactorEnabled, // feature:totp
  };
}

/**
 * The account behind each plain record a store handed out, as that store read
 * it. A sign-in takes the record back and finishes with this account, so it
 * never reads the account a second time and never signs in a record that did
 * not come from a store.
 */
const HANDED_OUT = new WeakMap<object, SignInAccount>();

export function rememberSignInAccount<Record extends object>(
  record: Record,
  account: SignInAccount,
): Record {
  HANDED_OUT.set(record, account);
  return record;
}

export function signInAccountOf(record: object): SignInAccount {
  const account = HANDED_OUT.get(record);
  if (!account) {
    throw new Error('This account was not read from PostgreSQL');
  }
  return account;
}
