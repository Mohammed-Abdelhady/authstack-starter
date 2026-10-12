// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TimelineList } from '../TimelineList';

interface Row {
  id: string;
}

/** A row with state of its own: whether it was pressed. */
function PressableRow({ id }: Row) {
  const [pressed, setPressed] = useState(false);
  return (
    <button data-testid={`row-${id}`} aria-pressed={pressed} onClick={() => setPressed(true)} />
  );
}

const list = (rows: Row[]) => (
  <TimelineList
    items={rows}
    itemKey={(row) => row.id}
    renderItem={(row) => <PressableRow id={row.id} />}
  />
);

const pressed = (id: string) => screen.getByTestId(`row-${id}`).getAttribute('aria-pressed');

afterEach(cleanup);

describe('TimelineList', () => {
  it('keeps the state of a row with its item when the list is re-ordered', () => {
    const { rerender } = render(list([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    fireEvent.click(screen.getByTestId('row-b'));

    rerender(list([{ id: 'b' }, { id: 'c' }, { id: 'a' }]));

    expect([pressed('a'), pressed('b'), pressed('c')]).toEqual(['false', 'true', 'false']);
  });

  it('does not hand the state of a removed row to the row that takes its place', () => {
    const { rerender } = render(list([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    fireEvent.click(screen.getByTestId('row-b'));

    rerender(list([{ id: 'a' }, { id: 'c' }]));

    expect([pressed('a'), pressed('c')]).toEqual(['false', 'false']);
  });
});
