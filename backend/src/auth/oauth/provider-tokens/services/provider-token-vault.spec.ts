import { ConfigService } from '@nestjs/config';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import type { RevocableProvider } from '../revocable-provider';
import { MemoryProviderTokenStore } from '../testing/provider-token-memory.harness-spec';
import type { TokenToKeep } from '../types/provider-tokens';
import { ProviderTokenCrypto } from './provider-token-crypto';
import { ProviderTokenVault } from './provider-token-vault';

const OWNER = {
  provider: 'apple',
  subject: 'apple-sub-1',
  clientId: 'com.example.app',
};

class RecordingApple implements RevocableProvider {
  readonly revoked: { token: string; clientId: string }[] = [];

  revokeProviderToken(request: { token: string; clientId: string }) {
    this.revoked.push(request);
    return Promise.resolve({ kind: 'revoked' } as const);
  }
}

class RefusingStore extends MemoryProviderTokenStore {
  override keep(_token: TokenToKeep): Promise<void> {
    return Promise.reject(new Error('connection reset'));
  }
}

function vaultOver(store: MemoryProviderTokenStore) {
  const crypto = new ProviderTokenCrypto(
    new ConfigService({ providerTokens: { encryptionKey: 'k'.repeat(32) } }),
  );
  return new ProviderTokenVault(store, crypto, new FrozenClock(TEST_NOW));
}

describe('the provider token vault', () => {
  it('revokes at once a token the store would not keep, since nothing could revoke it later', async () => {
    const apple = new RecordingApple();

    await vaultOver(new RefusingStore()).keep(OWNER, 'refresh-1', apple);

    expect(apple.revoked).toEqual([
      { token: 'refresh-1', clientId: 'com.example.app' },
    ]);
  });

  it('keeps a token it could store, and revokes nothing', async () => {
    const apple = new RecordingApple();
    const store = new MemoryProviderTokenStore();

    await vaultOver(store).keep(OWNER, 'refresh-1', apple);

    expect(apple.revoked).toEqual([]);
    // Checked for an account a day later: sooner would revoke a sign-up's grant.
    expect(store.tokens).toMatchObject([
      {
        ...OWNER,
        storedAt: TEST_NOW,
        checkAfter: new Date(TEST_NOW.getTime() + 86_400_000),
      },
    ]);
  });
});
