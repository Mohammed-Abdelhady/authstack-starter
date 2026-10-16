import { ConfigService } from '@nestjs/config';
import { ProviderTokenCrypto } from './provider-token-crypto';

// A kept Apple token is what erasure revokes with; one that cannot be read
// after a key rotation leaves the grant alive at Apple.
const OLD_KEY = 'o'.repeat(32);
const NEW_KEY = 'n'.repeat(32);
const OWNER = {
  provider: 'apple',
  subject: 'apple-sub-1',
  clientId: 'com.example.app',
};

function cryptoWith(current?: string, previous?: string): ProviderTokenCrypto {
  return new ProviderTokenCrypto(
    new ConfigService({
      providerTokens: {
        encryptionKey: current,
        previousEncryptionKey: previous,
      },
    }),
  );
}

describe('provider token encryption', () => {
  it('reads a token written before a rotation through the previous key', () => {
    const sealed = cryptoWith(OLD_KEY).seal('refresh-1', OWNER);

    expect(cryptoWith(NEW_KEY, OLD_KEY).open(sealed, OWNER)).toBe('refresh-1');
  });

  it('reads nothing once neither configured key wrote the token', () => {
    const sealed = cryptoWith(OLD_KEY).seal('refresh-1', OWNER);

    expect(cryptoWith(NEW_KEY).open(sealed, OWNER)).toBeNull();
  });

  it("will not read one identity's token as another's", () => {
    const sealed = cryptoWith(NEW_KEY).seal('refresh-1', OWNER);

    expect(
      cryptoWith(NEW_KEY).open(sealed, { ...OWNER, subject: 'apple-sub-2' }),
    ).toBeNull();
  });

  it('keeps no token at all while no key is set', () => {
    expect(cryptoWith().canSeal()).toBe(false);
    expect(() => cryptoWith().seal('refresh-1', OWNER)).toThrow(
      /PROVIDER_TOKEN_ENCRYPTION_KEY/,
    );
  });
});
