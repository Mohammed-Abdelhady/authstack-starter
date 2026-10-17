import {
  readStringFields,
  REVOKE_REQUEST_FIELDS,
  TOKEN_REQUEST_FIELDS,
} from './native-request-shape';

const INVALID_VALUES: [string, unknown][] = [
  ['number', 7],
  ['array', ['x']],
  ['object', { value: 'x' }],
  ['null', null],
  ['undefined', undefined],
];

describe.each([
  [
    'token',
    TOKEN_REQUEST_FIELDS,
    [
      'grant_type',
      'code',
      'redirect_uri',
      'client_id',
      'client_secret',
      'code_verifier',
      'refresh_token',
    ],
  ],
  ['revoke', REVOKE_REQUEST_FIELDS, ['token', 'client_id', 'client_secret']],
] as const)('%s body shape', (_route, fields, requiredChecks) => {
  it.each(requiredChecks)('rejects every present non-string %s', (field) => {
    for (const [, value] of INVALID_VALUES) {
      expect(readStringFields({ [field]: value }, fields)).toBeUndefined();
    }
  });
});
