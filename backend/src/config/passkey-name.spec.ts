import configuration from './configuration';

describe('passkey prompt name', () => {
  const previous = process.env.WEBAUTHN_RP_NAME;

  afterAll(() => {
    if (previous === undefined) delete process.env.WEBAUTHN_RP_NAME;
    else process.env.WEBAUTHN_RP_NAME = previous;
  });

  it('defaults to Auth App and accepts a deployment override', () => {
    delete process.env.WEBAUTHN_RP_NAME;
    expect(configuration().passkeys.rpName).toBe('Auth App');
    process.env.WEBAUTHN_RP_NAME = 'Example Product';
    expect(configuration().passkeys.rpName).toBe('Example Product');
  });
});
