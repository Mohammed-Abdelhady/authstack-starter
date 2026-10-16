import type { ApplicationPolicyConfiguration } from '../../../../src/config/types/host-policy.type';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import { AudiencePolicy } from '../../../../src/session/applications/audience-policy';
import { AdminAudienceScopes } from '../../../../src/admin/services/users/admin-audience-scopes';
import { browserApplicationsForTest } from '../../../../src/common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AccountCreationPolicy } from '../../../../src/auth/services/registration/account-creation-policy';
import { AdminPermissionsService } from '../../../../src/admin/services/roles/admin-permissions.service';
import { AdminEmailChangeService } from '../../../../src/admin/services/users/admin-email-change.service';
import { AdminUserAccessService } from '../../../../src/admin/services/users/admin-user-access.service';
import { AdminUserCreateService } from '../../../../src/admin/services/users/admin-user-create.service';
import { AdminUserQueriesService } from '../../../../src/admin/services/users/admin-user-queries.service';
import { AdminUsersService } from '../../../../src/admin/services/users/admin-users.service';
import { VerificationCodeService } from '../../../../src/auth/services/codes/verification-code.service';
import { AuthMailService } from '../../../../src/auth/services/mail/auth-mail.service';
import { MailCounterService } from '../../../../src/auth/services/mail/mail-counter.service';
import { EmailChangeConfirmationService } from '../../../../src/auth/services/registration/email-change-confirmation.service';
import { RegistrationService } from '../../../../src/auth/services/registration/registration.service';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { HashService } from '../../../../src/common/services/hash.service';
import { MailDispatcherService } from '../../../../src/mail/mail-dispatcher.service';
import { MailOptions } from '../../../../src/mail/interfaces/mail-options.interface';
import { MailService } from '../../../../src/mail/mail.service';
import { RoleHierarchyService } from '../../../../src/role/services/role-hierarchy.service';
import { UserPermissionsService } from '../../../../src/user/services/user-permissions.service';
import { UserProfileService } from '../../../../src/user/services/user-profile.service';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { AccountsContractHarness } from './accounts-contract-harness';
import { DisabledErasureLock } from '../../../../src/auth/contracts/defaults/disabled-erasure-lock';
import {
  testLastAdminGuard,
  testStaffMutationRules,
} from '../../admin/staff-mutation-test-kit';

export type AccountsHarnessSource = () => AccountsContractHarness;

export const ADMIN_SLUG = 'admin';
export const MANAGER_SLUG = 'manager';
export const SUPPORT_SLUG = 'support';
export const DEFAULT_SLUG = 'user';
export const EDITOR_SLUG = 'content-editor';

export const READ_POSTS = 'posts:read:all';
export const READ_USERS = 'users:read:all';

export const REVOKED_ALL = 'sessions_revoked_all';
export const REVOKED_OTHERS = 'sessions_revoked_others';
export const ADMIN_FORCED = 'admin_forced';
export const ALL_USER = 'all_user';
export const ALL_OTHER = 'all_other';

/** Written out, so a changed constant cannot agree with itself. */
export const BCRYPT_ROUNDS = 4;
export const OLD_PASSWORD = 'OldPassword123!';
export const NEW_PASSWORD = 'NewPassword123!';

export interface AccountServices {
  profile: UserProfileService;
  permissions: UserPermissionsService;
  adminPermissions: AdminPermissionsService;
  adminUsers: AdminUsersService;
  adminCreate: AdminUserCreateService;
  adminQueries: AdminUserQueriesService;
  registration: RegistrationService;
  emailChange: EmailChangeConfirmationService;
  verification: VerificationCodeService;
  /** Mail the services handed over, newest last. */
  mail: MailOptions[];
}

export function configurationForAccounts(
  auth: Record<string, unknown> = {},
): ConfigService {
  return new ConfigService({
    activation: { maxAttempts: 5, codeExpiresIn: 900_000 },
    bcrypt: { rounds: BCRYPT_ROUNDS },
    cors: { clientUrl: 'http://localhost:3000' },
    smtp: { from: 'contract@example.test' },
    auth,
  });
}

/** Persist configured policy before constructing a service that reads stored authority. */
export async function configureCreationApplications(
  harness: AccountsContractHarness,
  config: ConfigService,
): Promise<void> {
  for (const clientId of [WEB_CLIENT_ID, ADMIN_CLIENT_ID]) {
    await harness.configureCreationApplication(
      clientId,
      config.get<ApplicationPolicyConfiguration>(`auth.${clientId}.signIn`, {}),
    );
  }
}

/** The real services on this database's adapters and that runner. */
export function servicesOn(
  harness: AccountsContractHarness,
  pause: RerunPause = rerunAtOnce,
  policy: AccountCreationPolicy | undefined = undefined,
  config: ConfigService = configurationForAccounts(),
): AccountServices {
  const creationPolicy =
    policy ?? new AccountCreationPolicy(harness.issuanceApplications);
  const audiences = new AudiencePolicy(config);
  const scopes = new AdminAudienceScopes(audiences, harness.roleChanges);
  const browserApplications = browserApplicationsForTest(config);
  const runner = harness.runner(pause);
  const mail: MailOptions[] = [];
  const mailService = new MailService(config);
  mailService.sendMail = (options: MailOptions): Promise<void> => {
    mail.push(options);
    return Promise.resolve();
  };
  const authMail = new AuthMailService(
    mailService,
    new MailDispatcherService(config, mailService),
  );
  const hash = new HashService(config);
  const mailCounter = new MailCounterService(
    harness.mailCounters,
    config,
    harness.clock,
  );
  const verification = new VerificationCodeService(
    harness.registrations,
    hash,
    config,
    harness.clock,
    mailCounter,
  );
  const access = new AdminUserAccessService(
    harness.admin,
    new RoleHierarchyService(harness.roleCatalog),
    scopes,
  );
  const permissions = new UserPermissionsService(harness.permissions);
  const emailChanges = new AdminEmailChangeService(
    harness.admin,
    verification,
    authMail,
    config,
    harness.ledger,
    runner,
    harness.clock,
    scopes,
  );
  return {
    profile: new UserProfileService(
      harness.profiles,
      harness.sessions,
      runner,
      harness.clock,
      hash,
    ),
    permissions,
    adminPermissions: new AdminPermissionsService(
      harness.admin,
      access,
      permissions,
      runner,
      harness.roleChanges,
      audiences,
      testStaffMutationRules(),
    ),
    adminUsers: new AdminUsersService(
      harness.admin,
      harness.sessions,
      runner,
      harness.roleChanges,
      harness.roleSweeps,
      access,
      emailChanges,
      audiences,
      testStaffMutationRules(),
      new DisabledErasureLock(),
      testLastAdminGuard(),
    ),
    adminCreate: new AdminUserCreateService(
      harness.admin,
      runner,
      harness.roleChanges,
      harness.roleSweeps,
      access,
      hash,
      creationPolicy,
      harness.ledger,
      harness.clock,
      audiences,
      testStaffMutationRules(),
      harness.passwords,
    ),
    adminQueries: new AdminUserQueriesService(harness.admin, access),
    registration: new RegistrationService(
      harness.activation,
      runner,
      hash,
      authMail,
      verification,
      mailCounter,
      harness.signIn,
      creationPolicy,
      harness.ledger,
      harness.clock,
      browserApplications,
    ),
    emailChange: new EmailChangeConfirmationService(
      harness.activation,
      runner,
      verification,
      harness.sessions,
      harness.ledger,
      harness.clock,
    ),
    verification,
    mail,
  };
}

export interface AccountsFixture {
  adminId: string;
  secondAdminId: string;
  managerId: string;
  supportId: string;
  userId: string;
  editorRoleId: string;
  defaultRoleId: string;
}

export function passwordHash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** The code and status an application error carries, or the error's name. */
export function answerOf(error: unknown): { code: unknown; status: unknown } {
  if (!(error instanceof Error)) {
    return { code: 'not an error', status: undefined };
  }
  return {
    code: Reflect.get(error, 'code') ?? error.name,
    status: Reflect.get(error, 'status'),
  };
}

/** Awaits a promise that must reject and answers with its code and status. */
export async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: unknown; status: unknown }> {
  try {
    await promise;
  } catch (error) {
    return answerOf(error);
  }
  throw new Error('expected a refusal');
}

/** Who was signed out, by whom and why, sorted so storage order does not matter. */
export async function revocationsOf(
  harness: AccountsContractHarness,
): Promise<string[]> {
  const events = await harness.events();
  return events
    .filter(
      (event) =>
        event.action === REVOKED_ALL || event.action === REVOKED_OTHERS,
    )
    .map(
      (event) =>
        `${event.action} of ${event.targetUserId ?? 'nobody'} by ${event.actorId ?? 'nobody'} (${event.reasonCode ?? 'no reason'})`,
    )
    .sort();
}

/** The stored facts of an account that must exist. */
export async function storedAccount(
  harness: AccountsContractHarness,
  userId: string,
) {
  const account = await harness.account(userId);
  if (!account) {
    throw new Error(`account ${userId} is not stored`);
  }
  return account;
}

/** Read the code from the real mail handed to the transport boundary. */
export function lastMailedCode(services: AccountServices): string {
  const last = services.mail[services.mail.length - 1];
  const code = /\b(\d{6})\b/.exec(`${last?.text ?? ''} ${last?.html ?? ''}`);
  if (!code) throw new Error('the last mail carried no code');
  return code[1];
}
