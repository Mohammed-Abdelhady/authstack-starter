import { buildInvitationMail } from '../../../mail/builders/invitation';
import { SUPPORTED_LOCALES } from '../../../common/constants/locales';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { ROLE_AUDIENCE } from '../../../host/types/host-role.type';
import { invitationLink } from '../../../mail/links/invitation-links';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import {
  INVITATION_INVALID_MESSAGE,
  INVITATION_PURPOSE,
} from '../constants/invitations';
import type { StoredInvitation } from '../types/invitation';
import { invitationApplication } from './invitation-application';
import {
  requireEnrolmentAccount,
  requireOpenInvitation,
} from './invitation-validity';

const NOW = new Date('2026-10-16T00:00:00Z');
const INVITATION: StoredInvitation = {
  id: 'invitation-id',
  purpose: INVITATION_PURPOSE.ACCOUNT,
  email: 'invitee@example.test',
  roleId: 'role-id',
  roleSlug: 'user',
  clientId: 'web',
  locale: 'en',
  tokenHash: 'hash',
  expiresAt: new Date(NOW.getTime() + 1),
  createdAt: NOW,
  updatedAt: NOW,
};

describe('invitation boundary decisions', () => {
  // A token in a path or query would escape through server and referrer logs.
  it('keeps the token only in a recoverable fragment on the application origin', () => {
    const token = 'secret&with+reserved#characters';
    const link = new URL(
      invitationLink(
        'https://staff.example.test/base?old=value',
        token,
        INVITATION_PURPOSE.ACCOUNT,
      ),
    );
    expect(link.origin).toBe('https://staff.example.test');
    expect(link.pathname).toBe('/base');
    expect(link.search).toBe('?old=value');
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe(token);
    expect(new URLSearchParams(link.hash.slice(1)).get('purpose')).toBe(
      'account',
    );
    link.hash = '';
    expect(link.toString()).not.toContain('secret');
  });

  // Sending staff to the customer application can prevent their first sign-in.
  it.each([
    ['user', undefined, true, 'web'],
    ['customer-role', ROLE_AUDIENCE.CUSTOMER, true, 'web'],
    ['operator', ROLE_AUDIENCE.STAFF, true, 'admin'],
    ['admin', undefined, true, 'admin'],
    ['admin', ROLE_AUDIENCE.CUSTOMER, true, 'admin'],
    ['operator', ROLE_AUDIENCE.STAFF, false, 'web'],
    ['admin', undefined, false, 'web'],
  ] as const)(
    'routes %s with audience %s and admin configured=%s to %s',
    (slug, audience, configured, expected) => {
      const applications = new BrowserApplications(
        new ConfigService(
          configured ? { ADMIN_URL: 'https://staff.example.test' } : {},
        ),
        () => Promise.resolve(true),
      );
      expect(invitationApplication({ slug, audience }, applications)).toBe(
        expected,
      );
    },
  );

  // Different refusal envelopes disclose token state and can permit credential replay.
  it.each([
    null,
    { ...INVITATION, acceptedAt: NOW },
    { ...INVITATION, revokedAt: NOW },
    { ...INVITATION, expiresAt: NOW },
    { ...INVITATION, expiresAt: new Date(NOW.getTime() - 1) },
  ])('uniformly refuses an unavailable token %#', (invitation) => {
    let error: unknown;
    try {
      requireOpenInvitation(invitation, NOW);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppException);
    if (!(error instanceof AppException))
      throw new Error('Expected invitation refusal');
    expect({
      code: error.code,
      status: error.getStatus(),
      message: error.message,
    }).toEqual({
      code: ErrorCode.INVITATION_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: INVITATION_INVALID_MESSAGE,
    });
  });

  // An off-by-one expiry decision can reject a still-live credential.
  it('accepts the final millisecond before expiry', () => {
    expect(requireOpenInvitation(INVITATION, NOW).id).toBe('invitation-id');
  });

  // A link mailed to an address the account has since left lets that old mailbox enrol a passkey.
  describe('enrolment link account binding', () => {
    const LINK: StoredInvitation = {
      ...INVITATION,
      purpose: INVITATION_PURPOSE.ENROLMENT,
      email: 'owner@example.test',
      userId: 'user-id',
      addressGeneration: 3,
    };
    const ACCOUNT = {
      email: 'owner@example.test',
      addressGeneration: 3,
      isDeleted: false,
    };

    it.each([
      ['a later address generation', { ...ACCOUNT, addressGeneration: 4 }],
      ['another address', { ...ACCOUNT, email: 'new@example.test' }],
      ['a deleted account', { ...ACCOUNT, isDeleted: true }],
      ['no account', null],
    ])('refuses %s', (_case, account) => {
      expect(() => requireEnrolmentAccount(LINK, account)).toThrow(
        INVITATION_INVALID_MESSAGE,
      );
    });

    it('refuses a link stored without a generation', () => {
      const { addressGeneration: _dropped, ...unbound } = LINK;
      expect(() => requireEnrolmentAccount(unbound, ACCOUNT)).toThrow(
        INVITATION_INVALID_MESSAGE,
      );
    });

    it('admits the account at the address and generation it was mailed for', () => {
      expect(requireEnrolmentAccount(LINK, ACCOUNT)).toBe(ACCOUNT);
    });
  });
});

// An inviter-controlled name must not inject active markup into a mailed invitation.
it.each(SUPPORTED_LOCALES)('escapes inviter markup in %s mail', (locale) => {
  const name = '<img src=x onerror=alert(1)>';
  const content = buildInvitationMail({
    locale,
    link: 'https://example.test/#token=secret',
    expiresInDays: 7,
    inviterName: name,
  });
  expect(content.html).not.toContain(name);
  expect(content.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(content.text).toContain(name);
});
