import { ConfigService } from '@nestjs/config';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../../src/session/constants/session-policy';
import { bootE2eApp } from '../e2e-app';
import { startLocalOAuth } from '../oauth/local-oauth';
import {
  startBrowserMongoE2eStorage,
  watchMongoFixtureConnections,
} from '../e2e-mongo-storage';
import { useE2eStorage } from '../e2e-storage';

async function main(): Promise<void> {
  useE2eStorage({
    start: startBrowserMongoE2eStorage,
    watchConnections: watchMongoFixtureConnections,
  });
  const oauth = await startLocalOAuth();
  const fixture = await bootE2eApp(5107, {
    browserStrategy: oauth.strategy,
    beforeStart: (app) => {
      if (process.env.STARTER_E2E_STRICT_MUTATIONS === 'true') {
        app.get(ConfigService).set('admin.strictMutations', true);
      }
    },
  }).catch(async (error: unknown) => {
    await oauth.close();
    throw error;
  });
  let stopping = false;
  let proofClock: Date | undefined;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      await fixture.close();
    } finally {
      await oauth.close();
    }
    process.exit(process.exitCode ?? 0);
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('disconnect', () => {
    void stop();
  });
  process.on('message', (message: unknown) => {
    if (message === 'pause-http') {
      fixture.httpServer.close(() => process.send?.('http-paused'));
      fixture.httpServer.closeAllConnections();
    } else if (message === 'resume-http') {
      fixture.httpServer.listen(5107, '127.0.0.1', () =>
        process.send?.('http-resumed'),
      );
    } else if (message === 'mail') {
      process.send?.({ type: 'mail', messages: fixture.mail });
    } else if (message === 'expire-magic-links') {
      void fixture.state.auth
        .expireMagicLinks()
        .then(() => process.send?.('expired-magic-links'))
        .catch((error: unknown) => {
          console.error(error);
          process.exitCode = 1;
          void stop();
        });
    } else if (message === 'expire-staff-proof') {
      proofClock ??= fixture.clock.now();
      fixture.clock.advance(SENSITIVE_ACTION_WINDOW_MS + 1);
      process.send?.('staff-proof-expired');
    } else if (message === 'reset') {
      if (proofClock) {
        fixture.clock.set(proofClock);
        proofClock = undefined;
      }
      oauth.reset();
      void fixture
        .reset()
        .then(() => process.send?.('reset'))
        .catch((error: unknown) => {
          console.error(error);
          process.exitCode = 1;
          void stop();
        });
    }
  });
  process.send?.('ready');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
