import { SUPPORTED_LOCALES } from '../../common/constants/locales';
import { catalogueDifferences } from './catalogue-parity';
import { MAIL_CATALOGUES } from './mail-catalogue';

describe('mail catalogue parity', () => {
  it.each(SUPPORTED_LOCALES)(
    'finds every key, argument and plural form of English in %s',
    (locale) => {
      expect(
        catalogueDifferences(
          MAIL_CATALOGUES.en,
          MAIL_CATALOGUES[locale],
          locale,
        ),
      ).toEqual([]);
    },
  );

  it('reports a security notice sentence one language lacks', () => {
    const notices = Object.fromEntries(
      Object.entries(MAIL_CATALOGUES.en.securityNotice).filter(
        ([key]) => key !== 'passkeyAddedText',
      ),
    );
    const other = { ...MAIL_CATALOGUES.en, securityNotice: notices };

    expect(catalogueDifferences(MAIL_CATALOGUES.en, other, 'en')).toEqual([
      'securityNotice.passkeyAddedText: missing',
    ]);
  });

  it('reports a key one language lacks, and one only the other has', () => {
    const reference = { notice: { subject: 'Subject', body: 'Body' } };
    const other = { notice: { subject: 'Objet', footer: 'Pied' } };

    expect(catalogueDifferences(reference, other, 'en')).toEqual([
      'notice.body: missing',
      'notice.footer: not in the reference language',
    ]);
  });

  it('reports a mail one language lacks as each of its keys', () => {
    const reference = { notice: { subject: 'Subject' }, code: { line: 'X' } };
    const other = { notice: { subject: 'Objet' } };

    expect(catalogueDifferences(reference, other, 'en')).toEqual([
      'code.line: missing',
    ]);
  });

  it('reports an argument renamed, dropped or added', () => {
    const reference = {
      code: { greeting: 'Hi {name},', line: 'Code: {code}', end: 'Bye' },
    };
    const other = {
      code: { greeting: 'Hi {nom},', line: 'Code', end: 'Bye {name}' },
    };

    expect(catalogueDifferences(reference, other, 'en')).toEqual([
      'code.end: arguments {name}, expected {}',
      'code.greeting: arguments {nom}, expected {name}',
      'code.line: arguments {}, expected {code}',
    ]);
  });

  it('reports a counted phrase that lacks a form its language selects', () => {
    const reference = {
      common: { minutes: { one: '{count} minute', other: '{count} minutes' } },
    };
    const other = { common: { minutes: { other: '{count} minutes' } } };

    expect(catalogueDifferences(reference, other, 'en')).toEqual([
      'common.minutes: no "one" form',
    ]);
  });

  it('reports a phrase counted in one language and plain in the other', () => {
    const reference = {
      common: { minutes: { one: '{count} minute', other: '{count} minutes' } },
    };
    const other = { common: { minutes: '{count} minutes' } };

    expect(catalogueDifferences(reference, other, 'en')).toEqual([
      'common.minutes: counted in one language only',
    ]);
  });
});
