import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import { MAGIC_LINK_SENT_MESSAGE } from '../constants/magic-link.constants';
import {
  LINK_REQUEST,
  linkServices,
  LinkServices,
  MagicLinkHarnessSource,
  ONE_HOUR_MS,
} from './magic-link-contract.harness-spec';

const EMAIL = 'link@example.test';
const REQUEST_CALLS = [
  'accounts.hasDeletedAccount',
  'links.takeRequestSlot',
  'links.insertLink',
];
const ANSWER = {
  success: true,
  data: { email: EMAIL },
  message: MAGIC_LINK_SENT_MESSAGE,
};
/** More callers than the cap of five has room for. */
const CALLERS = 8;

interface PathWork {
  answer: unknown;
  calls: string[];
  mailsStarted: number;
  mailsFinishedBeforeTheAnswer: number;
  linksStored: number;
}

/** The hourly cap, and the work of every request whether or not it mails. */
export function magicLinkCapCases(harness: MagicLinkHarnessSource): void {
  let services: LinkServices;

  beforeEach(() => {
    services = linkServices(harness());
  });

  const request = (email = EMAIL) =>
    services.service.request({ email }, LINK_REQUEST);

  /** One request, with the work it did before it answered. */
  const work = async (email = EMAIL): Promise<PathWork> => {
    await services.settleMail();
    services.storeCalls.length = 0;
    const mails = services.mail.length;
    const finished = services.finishedMail();
    const links = await harness().linkCount();

    const answer = await request(email);
    const mailsFinishedBeforeTheAnswer = services.finishedMail() - finished;

    return {
      answer: { ...answer, data: { ...answer.data } },
      calls: [...services.storeCalls],
      mailsStarted: services.mail.length - mails,
      mailsFinishedBeforeTheAnswer,
      linksStored: (await harness().linkCount()) - links,
    };
  };

  const worked = (mailsStarted: number): PathWork => ({
    answer: ANSWER,
    calls: REQUEST_CALLS,
    mailsStarted,
    mailsFinishedBeforeTheAnswer: 0,
    linksStored: 1,
  });

  /** How many of the links stored so far can still be spent. */
  const unspentLinks = async (): Promise<number> => {
    const stored = await Promise.all(
      services.storedHashes.map((hash) => harness().link(hash)),
    );
    return stored.filter((link) => link?.consumedAt === null).length;
  };

  /** Fires `CALLERS` requests that all reach the cap before any is counted. */
  const requestAllAtOnce = async (): Promise<void> => {
    const gate = new RaceGate();
    const restore = holdBefore(harness().links, 'takeRequestSlot', () => gate);
    try {
      const requests = Array.from({ length: CALLERS }, () => request());
      await gate.reached(CALLERS);
      gate.release();
      await Promise.all(requests);
    } finally {
      restore();
    }
    await services.settleMail();
  };

  it('does the same work and answers the same whether or not it mails', async () => {
    await harness().seedAccount({
      email: 'known@example.test',
      isVerified: true,
      isDeleted: false,
    });
    await harness().seedAccount({
      email: 'gone@example.test',
      isVerified: true,
      isDeleted: true,
    });
    const answered = (email: string): PathWork => ({
      ...worked(1),
      answer: { ...ANSWER, data: { email } },
    });

    const unknown = await work('unknown@example.test');
    const known = await work('known@example.test');
    const withPendingLink = await work('known@example.test');
    const deleted = await work('gone@example.test');
    for (let mailed = 2; mailed < 5; mailed += 1) {
      await request('known@example.test');
    }
    const overCap = await work('known@example.test');

    expect({ unknown, known, withPendingLink, deleted, overCap }).toEqual({
      unknown: answered('unknown@example.test'),
      known: answered('known@example.test'),
      withPendingLink: answered('known@example.test'),
      deleted: { ...answered('gone@example.test'), mailsStarted: 0 },
      overCap: { ...answered('known@example.test'), mailsStarted: 0 },
    });
  });

  it('stores a spent link nobody holds the token of for a deleted account', async () => {
    await harness().seedAccount({
      email: EMAIL,
      isVerified: true,
      isDeleted: true,
    });

    await request();
    await services.settleMail();
    const [hash] = services.storedHashes;

    expect({
      mails: services.mail.length,
      stored: (await harness().link(hash ?? ''))?.consumedAt,
    }).toEqual({ mails: 0, stored: TEST_NOW });
  });

  it('mails the fifth link of an hour and not the sixth, which is stored spent', async () => {
    const mailsAfter: number[] = [];
    for (let asked = 1; asked <= 6; asked += 1) {
      await request();
      mailsAfter.push(services.mail.length);
    }
    const sixth = await harness().link(services.storedHashes[5] ?? '');

    expect({
      mailsAfter,
      unspent: await unspentLinks(),
      sixthSpentAt: sixth?.consumedAt,
    }).toEqual({
      mailsAfter: [1, 2, 3, 4, 5, 5],
      unspent: 5,
      sixthSpentAt: TEST_NOW,
    });
  });

  it('keeps the cap until the hour of the first link ends, whatever was refused meanwhile', async () => {
    for (let asked = 1; asked <= 5; asked += 1) {
      await request();
    }
    harness().clock.set(new Date(TEST_NOW.getTime() + ONE_HOUR_MS - 1));
    await request();
    const beforeTheHourEnds = services.mail.length;

    harness().clock.set(new Date(TEST_NOW.getTime() + ONE_HOUR_MS));
    const mailsAfter: number[] = [];
    for (let asked = 1; asked <= 6; asked += 1) {
      await request();
      mailsAfter.push(services.mail.length);
    }

    expect({ beforeTheHourEnds, mailsAfter }).toEqual({
      beforeTheHourEnds: 5,
      mailsAfter: [6, 7, 8, 9, 10, 10],
    });
  });

  it('caps each address by itself', async () => {
    for (let asked = 1; asked <= 6; asked += 1) {
      await request();
    }

    await request('other@example.test');

    expect({
      mails: services.mail.map(({ to }) => to),
    }).toEqual({
      mails: [EMAIL, EMAIL, EMAIL, EMAIL, EMAIL, 'other@example.test'],
    });
  });

  it('mails exactly the cap when more requests than that arrive at once for a new address', async () => {
    await requestAllAtOnce();

    expect({
      mails: services.mail.length,
      unspent: await unspentLinks(),
      links: await harness().linkCount(),
    }).toEqual({ mails: 5, unspent: 5, links: CALLERS });
  });

  it('mails exactly what the cap has left when requests arrive at once at its edge', async () => {
    for (let asked = 1; asked <= 3; asked += 1) {
      await request();
    }
    await requestAllAtOnce();

    expect({
      mails: services.mail.length,
      unspent: await unspentLinks(),
      links: await harness().linkCount(),
    }).toEqual({ mails: 5, unspent: 5, links: 3 + CALLERS });
  });
}
