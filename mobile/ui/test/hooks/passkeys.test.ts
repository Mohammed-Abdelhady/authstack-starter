import type { PasskeyActions } from '@app/native-auth';
import type { PasskeyList, PasskeySummary } from '@app/sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePasskeys } from '../../src/hooks/use-passkeys';
import { deferred, signedInAs, type Deferred } from '../support/fake-engine';
import { renderUiHook } from '../support/hook';
import { cleanup, flush } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

function passkey(id: string, name: string): PasskeySummary {
  return { id, name, backedUp: true, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null };
}

/** The engine's passkey actions, each call held open until the case answers it. */
class HeldActions implements PasskeyActions {
  readonly lists: Deferred<PasskeyList>[] = [];
  readonly renames: { passkeyId: string; answer: Deferred<PasskeySummary> }[] = [];

  available = async () => true;
  register = async () => ({ kind: 'cancelled' as const });
  list = () => {
    const answer = deferred<PasskeyList>();
    this.lists.push(answer);
    return answer.promise;
  };
  rename = (passkeyId: string) => {
    const answer = deferred<PasskeySummary>();
    this.renames.push({ passkeyId, answer });
    return answer.promise;
  };
  remove = async () => ({ message: 'Passkey removed' });
}

async function section(actions: HeldActions) {
  const subject = await renderUiHook(() => usePasskeys(actions), signedInAs('ada'));
  await act(async () => {
    actions.lists[0]?.resolve({ passkeys: [passkey('a', 'Old'), passkey('b', 'Tablet')] });
  });
  await flush();
  return subject;
}

describe('the passkeys section hook', () => {
  it('keeps the rows while a refresh runs, and a read older than a rename never brings the old name back', async () => {
    const actions = new HeldActions();
    const subject = await section(actions);

    act(() => subject.current().reload());
    expect(subject.current().view).toBe('ready');
    let renamed: Promise<boolean> | undefined;
    act(() => {
      renamed = subject.current().rename(passkey('a', 'Old'), 'New');
    });
    await act(async () => {
      actions.renames[0]?.answer.resolve(passkey('a', 'New'));
      await renamed;
    });
    await act(async () => {
      actions.lists[1]?.resolve({ passkeys: [passkey('a', 'Old'), passkey('b', 'Tablet')] });
    });
    await flush();

    expect(subject.current().passkeys.map((item) => item.name)).toEqual(['New', 'Tablet']);
  });

  it('starts no second write on a row with one in flight, and finishing another row leaves it busy', async () => {
    const actions = new HeldActions();
    const subject = await section(actions);
    const results: Promise<boolean>[] = [];

    act(() => {
      results.push(subject.current().rename(passkey('a', 'Old'), 'First'));
      results.push(subject.current().rename(passkey('a', 'Old'), 'Second'));
      results.push(subject.current().rename(passkey('b', 'Tablet'), 'Phone'));
    });
    await act(async () => {
      actions.renames[1]?.answer.resolve(passkey('b', 'Phone'));
      await results[2];
    });

    expect(actions.renames.map((call) => call.passkeyId)).toEqual(['a', 'b']);
    expect(await results[1]).toBe(false);
    expect([...subject.current().busyRows]).toEqual(['a']);
  });
});
