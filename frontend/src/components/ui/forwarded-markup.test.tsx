// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { UNSAFE_MARKUP_PROP } from '@/lib/unsafeMarkup';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Badge } from './badge';
import { SplitView } from '@/components/design-system/layout/SplitView';

const PAYLOAD = {
  [UNSAFE_MARKUP_PROP]: { __html: '<strong data-testid="injected">payload</strong>' },
};
afterEach(cleanup);

it('keeps typed button and badge content when runtime props contain markup', () => {
  render(
    <>
      <Button {...PAYLOAD}>button-content</Button>
      <Badge {...PAYLOAD}>badge-content</Badge>
    </>,
  );
  expect(screen.getByRole('button').textContent).toBe('button-content');
  expect(screen.getByText('badge-content')).toBeTruthy();
  expect(screen.queryByTestId('injected')).toBeNull();
});

it('names the split-view sidebar and preserves both panes against runtime markup', () => {
  render(
    <SplitView
      sidebar="sidebar-content"
      content="pane-content"
      sidebarLabel="sidebar-label"
      {...PAYLOAD}
    />,
  );
  expect(screen.getByRole('complementary', { name: 'sidebar-label' }).textContent).toBe(
    'sidebar-content',
  );
  expect(screen.getByText('pane-content')).toBeTruthy();
  expect(screen.queryByTestId('injected')).toBeNull();
});

it('preserves input values and refuses runtime markup without throwing', () => {
  render(
    <>
      <Input data-testid="input" defaultValue="input-value" {...PAYLOAD} />
      <Textarea data-testid="textarea" defaultValue="textarea-value" {...PAYLOAD} />
    </>,
  );
  expect(screen.getByTestId('input')).toHaveProperty('value', 'input-value');
  expect(screen.getByTestId('textarea')).toHaveProperty('value', 'textarea-value');
  expect(screen.queryByTestId('injected')).toBeNull();
});
