import type { SignOutOutcome } from '@app/native-auth';
import { describe, expect, it } from 'vitest';
import { revokeSession } from '../src/state/session-actions';
import { signedInAs } from './support/fake-engine';
import { ROUTE, session, settle } from './support/fake-server';
import { createSubject, type Subject } from './support/ui';

const PHONE = session('phone', { isCurrent: true, credentialPurpose: 'native_access' });
const LAPTOP = session('laptop');
const REVOKED: SignOutOutcome = { kind: 'signedOut', revocation: 'revoked' };

async function loaded(): Promise<Subject> {
  const subject = createSubject(signedInAs('ada'));
  await subject.load([PHONE, LAPTOP]);
  return subject;
}

/** Stands in for the dialog: counts the questions and gives each the same answer. */
function answering(confirmed: boolean) {
  const recorded = {
    asked: 0,
    confirm(): Promise<boolean> {
      recorded.asked += 1;
      return Promise.resolve(confirmed);
    },
  };
  return recorded;
}

describe('signing this device out from its row', () => {
  it('asks first and does nothing when the person declines', async () => {
    const subject = await loaded();
    const dialog = answering(false);

    const result = await revokeSession(subject.runtime, PHONE, dialog.confirm);

    expect({ result, asked: dialog.asked, signOuts: subject.fake.signOuts }).toEqual({
      result: 'cancelled',
      asked: 1,
      signOuts: 0,
    });
    expect(subject.runtime.engine.snapshot.status).toBe('signedIn');
  });

  it('signs out through the engine once the person confirms, and sends no revoke', async () => {
    const subject = await loaded();
    const dialog = answering(true);

    const result = await revokeSession(subject.runtime, PHONE, dialog.confirm);

    expect({
      result,
      asked: dialog.asked,
      signOuts: subject.fake.signOuts,
      sent: subject.server.sent(),
    }).toEqual({ result: 'signedOut', asked: 1, signOuts: 1, sent: [ROUTE.SESSIONS] });
  });

  it('waits for the engine before it reports the sign-out', async () => {
    const subject = await loaded();
    const signOut = subject.fake.holdSignOut();
    let result: string | undefined;

    void revokeSession(subject.runtime, PHONE, answering(true).confirm).then((value) => {
      result = value;
    });
    await settle();
    expect({ result, signOuts: subject.fake.signOuts }).toEqual({ result: undefined, signOuts: 1 });

    signOut.resolve(REVOKED);
    await settle();
    expect(result).toBe('signedOut');
  });

  it('reports a sign-out the engine could not do as not done, and does not throw', async () => {
    const subject = await loaded();
    subject.fake.failSignOut(new Error('port crashed'));

    const result = await revokeSession(subject.runtime, PHONE, answering(true).confirm);

    expect({ result, status: subject.runtime.engine.snapshot.status }).toEqual({
      result: 'undone',
      status: 'signedIn',
    });
  });

  it('drops the confirmation when the account changed while the question was open', async () => {
    const subject = await loaded();
    const dialog = {
      confirm(): Promise<boolean> {
        subject.fake.publish({ status: 'signedOut', operation: 'none' });
        subject.fake.publish(signedInAs('ben'));
        return Promise.resolve(true);
      },
    };

    const result = await revokeSession(subject.runtime, PHONE, dialog.confirm);

    expect({ result, signOuts: subject.fake.signOuts }).toEqual({
      result: 'superseded',
      signOuts: 0,
    });
  });
});
