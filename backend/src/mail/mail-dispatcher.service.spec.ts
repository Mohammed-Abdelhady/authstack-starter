import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MailDispatcherService } from './mail-dispatcher.service';
import { MailService } from './mail.service';
import { runWithRequestContext } from '../common/context/request-context';
import {
  MAIL_DRAIN_DEADLINE_LOG,
  MAIL_DRAIN_DEADLINE_MS,
  MAIL_MAX_PENDING_SENDS,
} from './constants/mail.constants';

interface DispatcherHarness {
  dispatcher: MailDispatcherService;
  closeTransport: jest.Mock;
}

async function buildDispatcher(options?: {
  maxPending?: number;
  drainDeadlineMs?: number;
}): Promise<DispatcherHarness> {
  const config = {
    get: (key: string, fallback?: number) => {
      if (key === 'mail.maxPendingSends') {
        return options?.maxPending ?? MAIL_MAX_PENDING_SENDS;
      }
      if (key === 'mail.drainDeadlineMs') {
        return options?.drainDeadlineMs ?? MAIL_DRAIN_DEADLINE_MS;
      }
      return fallback;
    },
  };
  const closeTransport = jest.fn();
  const module = await Test.createTestingModule({
    providers: [
      MailDispatcherService,
      { provide: ConfigService, useValue: config },
      { provide: MailService, useValue: { closeTransport } },
    ],
  }).compile();
  return {
    dispatcher: module.get(MailDispatcherService),
    closeTransport,
  };
}

function loggedLines(spy: jest.SpyInstance): string {
  return spy.mock.calls
    .map((call: unknown[]) => call.map((value) => String(value)).join(' '))
    .join('\n');
}

describe('MailDispatcherService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('logs a rejected send with the request id and lets no rejection escape', async () => {
    const { dispatcher } = await buildDispatcher();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    runWithRequestContext('req-fail', () => {
      dispatcher.dispatch(
        () => Promise.reject(new Error('smtp down')),
        'Failed to send activation email',
      );
    });
    await dispatcher.flush();

    const logged = loggedLines(errorSpy);
    expect(logged).toContain('requestId=req-fail');
    expect(logged).toContain('cause=Error');
  });

  it('logs sends cut off by the shutdown deadline and closes the transporter', async () => {
    const drainDeadlineMs = 20;
    const { dispatcher, closeTransport } = await buildDispatcher({
      drainDeadlineMs,
    });
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    jest.useFakeTimers();

    dispatcher.dispatch(
      () => new Promise<void>(() => undefined),
      'Failed to send activation email',
    );
    const shutdown = dispatcher.onApplicationShutdown();
    jest.advanceTimersByTime(drainDeadlineMs);
    await shutdown;

    expect(loggedLines(errorSpy)).toContain(MAIL_DRAIN_DEADLINE_LOG);
    expect(closeTransport).toHaveBeenCalledTimes(1);
  });
});
