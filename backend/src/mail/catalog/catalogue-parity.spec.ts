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
});
