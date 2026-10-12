import { Response } from 'express';
import { Kysely, sql } from 'kysely';
import {
  MAGIC_LINK_ACCOUNT_CONSTRAINT,
  MagicLinkAccount,
  MagicLinkAccounts,
  MagicLinkSignIn,
  MagicLinkSignInOutcome,
  NewPasswordlessAccount,
} from '../../stores/magic-link-accounts';
import {
  ClaimedMagicLink,
  MAGIC_LINK_CONSTRAINT,
  MagicLinkStore,
  NewMagicLink,
  UnspentMagicLink,
} from '../../stores/magic-link.store';
import { MAIL_COUNTER_PURPOSE } from '../../../constants/registration';
import { MailWindowRule } from '../../../pending-codes/mail-counter.store';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import {
  autocommit,
  storedAddress,
} from '../../../persistence/postgres/postgres-pending-codes-database';

import {
  SIGN_IN_COLUMNS,
  toSignInAccount,
} from '../../../persistence/postgres/postgres-sign-in-accounts';
import { secondFactorEnabled } from '../../../../user/persistence/postgres/postgres-account-rows'; // feature:totp
import { FIRST_FACTOR } from '../../../services/sessions/first-factor'; // feature:totp
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { SignInAccount } from '../../../utils/authenticated-user.util';

const LINK_CONSTRAINTS = {
  pending_magic_link_token_hash_unique: MAGIC_LINK_CONSTRAINT.TOKEN_HASH,
} as const;

const ACCOUNT_CONSTRAINTS = {
  user_email_unique: MAGIC_LINK_ACCOUNT_CONSTRAINT.ADDRESS,
} as const;

const NONE = {} as const;
const EMAIL_PROVIDER = 'email';

export class PostgresMagicLinkStore extends MagicLinkStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  /**
   * One upsert. A second writer waits on the row and counts on its new
   * version.
   */
  takeRequestSlot(email: string, rule: MailWindowRule): Promise<boolean> {
    const windowEnd = new Date(rule.now.getTime() + rule.windowMs);
    const rolledOverBefore = new Date(rule.now.getTime() - rule.windowMs);
    const rolledOver = sql<boolean>`mail_counters.window_started_at <= ${rolledOverBefore}`;
    return autocommit(NONE, async () => {
      const counter = await this.database
        .insertInto('mail_counters')
        .values({
          email: storedAddress(email),
          purpose: MAIL_COUNTER_PURPOSE.MAGIC_LINK,
          mailed_codes: 1,
          window_started_at: rule.now,
          expires_at: windowEnd,
        })
        .onConflict((conflict) =>
          conflict.columns(['email', 'purpose']).doUpdateSet({
            mailed_codes: sql<number>`CASE WHEN ${rolledOver} THEN 1 ELSE mail_counters.mailed_codes + 1 END`,
            window_started_at: sql<Date>`CASE WHEN ${rolledOver} THEN ${rule.now}::timestamptz ELSE mail_counters.window_started_at END`,
            expires_at: sql<Date>`CASE WHEN ${rolledOver} THEN ${windowEnd}::timestamptz ELSE mail_counters.expires_at END`,
          }),
        )
        .returning('mailed_codes')
        .executeTakeFirstOrThrow();
      return counter.mailed_codes <= rule.limit;
    });
  }

  async insertLink(link: NewMagicLink): Promise<void> {
    await autocommit(LINK_CONSTRAINTS, () =>
      this.database
        .insertInto('pending_magic_links')
        .values({
          email: storedAddress(link.email),
          token_hash: link.tokenHash,
          expires_at: link.expiresAt,
          consumed_at: link.consumedAt ?? null,
          request_ip: link.requestIp ?? null,
          user_agent: link.userAgent ?? null,
          redirect: link.redirect ?? null,
          request_nonce_hash: link.requestNonceHash ?? null,
        })
        .execute(),
    );
  }

  findUnspentLink(tokenHash: string): Promise<UnspentMagicLink | null> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .selectFrom('pending_magic_links')
        .select(['email', 'expires_at', 'request_nonce_hash'])
        .where('token_hash', '=', tokenHash)
        .where('consumed_at', 'is', null)
        .executeTakeFirst();
      return row
        ? {
            email: row.email,
            expiresAt: row.expires_at,
            requestNonceHash: row.request_nonce_hash,
          }
        : null;
    });
  }

  claimLink(tokenHash: string, now: Date): Promise<ClaimedMagicLink | null> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .updateTable('pending_magic_links')
        .set({ consumed_at: now })
        .where('token_hash', '=', tokenHash)
        .where('consumed_at', 'is', null)
        .returning(['email', 'expires_at', 'redirect'])
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      return {
        email: row.email,
        expiresAt: row.expires_at,
        ...(row.redirect ? { redirect: row.redirect } : {}),
      };
    });
  }
}

class PostgresMagicLinkAccount extends MagicLinkAccount {
  constructor(
    readonly signIn: SignInAccount,
    readonly isDeleted: boolean,
  ) {
    super();
  }

  get id(): string {
    return this.signIn.id;
  }

  get isVerified(): boolean {
    return this.signIn.isVerified;
  }
}

function readByThisStore(account: MagicLinkAccount): PostgresMagicLinkAccount {
  if (!(account instanceof PostgresMagicLinkAccount)) {
    throw new Error('This account was not read from PostgreSQL');
  }
  return account;
}

export class PostgresMagicLinkAccounts extends MagicLinkAccounts {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  findByEmail(email: string): Promise<MagicLinkAccount | null> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .selectFrom('users')
        .select([...SIGN_IN_COLUMNS, 'is_deleted'])
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row
        ? new PostgresMagicLinkAccount(
            toSignInAccount(
              row,
              await secondFactorEnabled(this.database, row.id), // feature:totp
            ),
            row.is_deleted,
          )
        : null;
    });
  }

  hasDeletedAccount(email: string): Promise<boolean> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .selectFrom('users')
        .select('is_deleted')
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row?.is_deleted === true;
    });
  }

  async markVerified(account: MagicLinkAccount): Promise<void> {
    const read = readByThisStore(account);
    await autocommit(NONE, () =>
      this.database
        .updateTable('users')
        .set({ is_verified: true })
        .where('id', '=', read.id)
        .execute(),
    );
    // The record follows the row, as the sign-in that comes next reads it.
    read.signIn.isVerified = true;
  }

  createPasswordless(
    account: NewPasswordlessAccount,
  ): Promise<MagicLinkAccount> {
    return autocommit(ACCOUNT_CONSTRAINTS, async () => {
      const row = await this.database
        .insertInto('users')
        .values({
          email: storedAddress(account.email),
          name: account.name,
          is_verified: true,
          auth_provider: EMAIL_PROVIDER,
          primary_provider: EMAIL_PROVIDER,
        })
        .returning(SIGN_IN_COLUMNS)
        .executeTakeFirstOrThrow();
      return new PostgresMagicLinkAccount(toSignInAccount(row), false);
    });
  }
}

/** Finishes the sign-in with the account the link flow read. */
export class PostgresMagicLinkSignIn extends MagicLinkSignIn {
  constructor(private readonly completion: SignInCompletion) {
    super();
  }

  complete(
    account: MagicLinkAccount,
    response: Response,
  ): Promise<MagicLinkSignInOutcome> {
    return this.completion.completeSignIn(
      readByThisStore(account).signIn,
      response,
      FIRST_FACTOR.MAGIC_LINK, // feature:totp
    );
  }
}
