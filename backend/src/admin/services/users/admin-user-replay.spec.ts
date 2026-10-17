import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { HashService } from '../../../common/services/hash.service';
import { assertReplayedPassword } from './admin-user-replay';

// Failure: a password changed after creation replaces the original keyed request identity.
describe('immutable replayed create password', () => {
  const hashes = new HashService(new ConfigService({ bcrypt: { rounds: 4 } }));
  let savedHash: string;
  beforeEach(async () => {
    savedHash = await hashes.hash('first-password');
  });

  it('accepts the original password using its committed hash', async () => {
    await expect(
      assertReplayedPassword(hashes, savedHash, 'first-password'),
    ).resolves.toBeUndefined();
  });

  it('refuses a later password against the original request', async () => {
    await expect(
      assertReplayedPassword(hashes, savedHash, 'second-password'),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('refuses a request whose original secret fingerprint is absent', async () => {
    await expect(
      assertReplayedPassword(hashes, null, 'first-password'),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});
