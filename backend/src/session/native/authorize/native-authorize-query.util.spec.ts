import { isValidAuthorizeQueryShape } from './native-authorize-query.util';

const VALID_AUTHORIZE_QUERY: Record<string, unknown> = {
  response_type: 'code',
  client_id: 'native-app',
  redirect_uri: 'myapp://callback',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
  state: 'state-1',
  scope: 'api',
};

describe('isValidAuthorizeQueryShape', () => {
  it('accepts an authorize query without scope', () => {
    expect(isValidAuthorizeQueryShape(omitParameter('scope'))).toBe(true);
  });

  it.each([
    { label: 'missing state', value: omitParameter('state') },
    { label: 'empty state', value: { ...VALID_AUTHORIZE_QUERY, state: '' } },
    { label: 'empty scope', value: { ...VALID_AUTHORIZE_QUERY, scope: '' } },
    {
      label: 'array client id',
      value: { ...VALID_AUTHORIZE_QUERY, client_id: ['a', 'b'] },
    },
    {
      label: 'array scope',
      value: { ...VALID_AUTHORIZE_QUERY, scope: ['api', 'other'] },
    },
    {
      label: 'array unknown parameter',
      value: { ...VALID_AUTHORIZE_QUERY, extra: ['a', 'b'] },
    },
  ])('$label is rejected', ({ value }) => {
    expect(isValidAuthorizeQueryShape(value)).toBe(false);
  });
});

function omitParameter(parameter: string): Record<string, unknown> {
  const query = { ...VALID_AUTHORIZE_QUERY };
  delete query[parameter];
  return query;
}
