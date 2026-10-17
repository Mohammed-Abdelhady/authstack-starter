import {
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { requiredRelyingParties } from './application-policy';
import type { IssuancePolicy } from './types/application-policy';

function policy(overrides: Partial<IssuancePolicy> = {}): IssuancePolicy {
  return {
    clientId: WEB_CLIENT_ID,
    platform: APPLICATION_PLATFORM.WEB,
    enabled: true,
    sessionVersion: 0,
    allowedScopes: ['api'],
    policy: { absoluteLifetimeMs: 7_200_000, idleLifetimeMs: 600_000 },
    requirePasskey: true,
    passkeyRelyingParty: {
      rpId: 'example.test',
      origins: ['https://app.example.test'],
    },
    ...overrides,
  };
}

describe('required relying parties', () => {
  it('requires nothing when there are no applications', () => {
    expect(requiredRelyingParties([], null)).toEqual([]);
  });

  it('includes unrestricted applications when the account has no named audience', () => {
    expect(
      requiredRelyingParties(
        [
          policy(),
          policy({ accountAudience: 'staff' }),
          policy({ accountAudience: 'customer' }),
        ],
        null,
      ),
    ).toEqual(['example.test']);
  });

  it('requires a staff-only relying party only for staff', () => {
    const policies = [policy({ accountAudience: 'staff' })];
    expect(requiredRelyingParties(policies, 'staff')).toEqual(['example.test']);
    expect(requiredRelyingParties(policies, 'customer')).toEqual([]);
    expect(requiredRelyingParties(policies, null)).toEqual([]);
  });

  it('deduplicates mixed applications and includes only those admitting the account', () => {
    const policies = [
      policy(),
      policy({ accountAudience: 'staff' }),
      policy({
        accountAudience: 'staff',
        passkeyRelyingParty: {
          rpId: 'admin.example.test',
          origins: ['https://admin.example.test'],
        },
      }),
      policy({
        accountAudience: 'customer',
        passkeyRelyingParty: {
          rpId: 'customer.example.test',
          origins: ['https://customer.example.test'],
        },
      }),
    ];
    expect(requiredRelyingParties(policies, 'staff')).toEqual([
      'example.test',
      'admin.example.test',
    ]);
    expect(requiredRelyingParties(policies, 'customer')).toEqual([
      'example.test',
      'customer.example.test',
    ]);
  });

  it('ignores optional applications and required applications without a relying party', () => {
    expect(
      requiredRelyingParties(
        [
          policy({ requirePasskey: false }),
          policy({ passkeyRelyingParty: null }),
        ],
        null,
      ),
    ).toEqual([]);
  });
});
