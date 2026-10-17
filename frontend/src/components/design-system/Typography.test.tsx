// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UNSAFE_MARKUP_PROP } from '@/lib/unsafeMarkup';
import { Description } from './Description';
import { Heading } from './Heading';

const INJECTED_TEST_ID = 'injected-markup';
const UNSAFE_PROPS: Record<string, unknown> = {
  [UNSAFE_MARKUP_PROP]: { __html: `<b data-testid="${INJECTED_TEST_ID}">injected</b>` },
};

afterEach(cleanup);

describe('Heading', () => {
  it('drops raw markup spread in through rest props', () => {
    render(<Heading level={2} variant="sectionTitle" {...UNSAFE_PROPS} />);

    expect(screen.queryByTestId(INJECTED_TEST_ID)).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).childNodes).toHaveLength(0);
  });
});

describe('Description', () => {
  it('drops raw markup spread in through rest props', () => {
    render(<Description data-testid="copy" {...UNSAFE_PROPS} />);

    expect(screen.queryByTestId(INJECTED_TEST_ID)).toBeNull();
    expect(screen.getByTestId('copy').childNodes).toHaveLength(0);
  });
});
