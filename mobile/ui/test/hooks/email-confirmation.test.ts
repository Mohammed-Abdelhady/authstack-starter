import { ACCOUNT_PATHS, type TransportRequest } from '@app/sdk';
import type { AbortSignalPort } from '@app/native-auth';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEmailConfirmation } from '../../src/hooks/use-email-confirmation';
import { SIGNED_OUT } from '../support/fake-engine';
import { createFakeServer, ok, refusal } from '../support/fake-server';
import { renderUiHook } from '../support/hook';
import { cleanup, flush, unmountAll } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(cleanup);
const ROUTE = `POST ${ACCOUNT_PATHS.confirmEmailFromApp}`;

async function form(code = '123456') {
  const server = createFakeServer();
  const sent: TransportRequest<AbortSignalPort>[] = [];
  const transport = {
    request: (request: TransportRequest<AbortSignalPort>) => {
      sent.push(request);
      return server.transport.request(request);
    },
  };
  const subject = await renderUiHook(
    () => useEmailConfirmation({ clientId: 'native-app', transport }),
    SIGNED_OUT,
  );
  act(() => {
    subject.current().setEmail('New@Example.Test');
    subject.current().setCode(code);
  });
  return { subject, server, sent };
}

describe('signed-out staff email confirmation', () => {
  it.each([
    '123456',
    '١٢٣٤٥٦', // feature:locale-ar
  ])('normalizes code %s and submits once without a session credential', async (code) => {
    const { subject, server, sent } = await form(code);
    act(() => {
      void subject.current().submit();
      void subject.current().submit();
    });
    await flush();
    expect(sent.map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: ACCOUNT_PATHS.confirmEmailFromApp,
        body: { clientId: 'native-app', email: 'new@example.test', code: '123456' },
      },
    ]);
    expect(Object.keys(sent[0]?.headers ?? {}).map((name) => name.toLowerCase())).not.toContain(
      'authorization',
    );
    server.answer(ROUTE, ok({ message: 'confirmed' }));
    await flush();
    expect(subject.current().confirmed).toBe(true);
    expect(subject.current().code).toBe('');
  });

  it('keeps the address and code after an invalid code and permits a corrected attempt', async () => {
    const { subject, server } = await form();
    act(() => {
      void subject.current().submit();
    });
    await flush();
    server.answer(ROUTE, refusal(400, 'ACTIVATION_CODE_INVALID'));
    await flush();
    expect({
      email: subject.current().email,
      code: subject.current().code,
      confirmed: subject.current().confirmed,
      busy: subject.current().busy,
    }).toEqual({ email: 'New@Example.Test', code: '123456', confirmed: false, busy: false });
    act(() => {
      subject.current().setCode('654321');
    });
    act(() => {
      void subject.current().submit();
    });
    await flush();
    server.answer(ROUTE, ok({ message: 'confirmed' }));
    await flush();
    expect(subject.current().confirmed).toBe(true);
  });

  it('aborts its request when the signed-out confirmation screen unmounts', async () => {
    const { subject, server, sent } = await form();
    act(() => {
      void subject.current().submit();
    });
    await flush();
    unmountAll();
    expect(sent[0]?.signal?.aborted).toBe(true);
    server.answer(ROUTE, ok({ message: 'confirmed' }));
    await flush();
  });
});
