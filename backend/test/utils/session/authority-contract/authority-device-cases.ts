import { AUTHORITY_CONTRACT_CASE_TIMEOUT_MS } from './authority-contract-harness';
import { AuthorityHarnessSource, signIn } from './authority-contract-support';

const SAFARI_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Version/17.2 Mobile/15E148 Safari/604.1';
/** What the port declares for a device label, and nothing derived from it. */
const LABEL = {
  type: 'mobile',
  browser: 'Safari 17',
  os: 'iOS 17',
  name: 'Safari 17 on iOS 17',
};

/** The device label of a session: the same four fields stored and handed back. */
export function authorityDeviceCases(harness: AuthorityHarnessSource): void {
  it(
    'stores a device label as its four fields and hands the same four back',
    async () => {
      const userId = await harness().issuance.seedAccount();
      const { sessionId, token } = await signIn(
        harness(),
        userId,
        SAFARI_ON_IPHONE,
      );
      const store = harness().authorityStore;

      const [stored] = await harness().issuance.sessions(userId);
      const found = await store.findSessionById(sessionId);
      const committed = await store.readCommittedSessionById(sessionId);
      const [listed] = await store.listSessionCandidates({
        userId,
        userVersion: 0,
        authEpoch: 1,
        now: harness().issuance.clock.now(),
        purposes: ['browser_session'],
      });

      expect({
        token: typeof token,
        stored: stored.device,
        found: found?.device,
        committed: committed?.device,
        listed: listed?.device,
        deviceName: found?.deviceName,
      }).toEqual({
        token: 'string',
        stored: LABEL,
        found: LABEL,
        committed: LABEL,
        listed: LABEL,
        deviceName: 'Safari 17 on iOS 17',
      });
    },
    AUTHORITY_CONTRACT_CASE_TIMEOUT_MS,
  );
}
