// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  descriptions,
  registerFormTestLifecycle,
  renderForm,
} from '@/tests/serverRejectionHarness';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const REASON = 'Not in season';

interface FruitSelectProps {
  readonly onValueChange: (value: string) => void;
  /** Where the fruit that cannot be chosen sits in the list. */
  readonly cherryAt?: 'first' | 'middle' | 'last';
}

/** Apple, Banana and Cherry. Cherry can be reached and not chosen. */
function FruitSelect({ onValueChange, cherryAt = 'middle' }: FruitSelectProps) {
  const cherry = (
    <SelectItem key="cherry" value="cherry" unavailableReason={<em>{REASON}</em>}>
      Cherry
    </SelectItem>
  );
  const others = [
    <SelectItem key="apple" value="apple">
      Apple
    </SelectItem>,
    <SelectItem key="banana" value="banana">
      Banana
    </SelectItem>,
  ];
  const items = {
    first: [cherry, ...others],
    middle: [others[0], cherry, others[1]],
    last: [...others, cherry],
  }[cherryAt];
  return (
    <Select value="apple" onValueChange={onValueChange}>
      <SelectTrigger data-testid="trigger">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{items}</SelectContent>
    </Select>
  );
}

async function openList(cherryAt?: FruitSelectProps['cherryAt']) {
  const onValueChange = vi.fn();
  await renderForm('en', <FruitSelect onValueChange={onValueChange} cherryAt={cherryAt} />);
  fireEvent.keyDown(screen.getByTestId('trigger'), { key: 'Enter' });
  const list = await screen.findByRole('listbox');
  const option = (name: string) => within(list).getByRole('option', { name });
  await waitFor(() => expect(document.activeElement).toBe(option('Apple')));
  return { onValueChange, list, option, cherry: option('Cherry') };
}

/** jsdom has no pointer events, so one is made from a mouse event and given its kind. */
function pointer(target: HTMLElement, type: 'pointerdown' | 'pointerup', pointerType: string) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  // The list of a select needs two DOM methods jsdom does not have.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

registerFormTestLifecycle();

describe('an option that can be reached and not chosen', () => {
  it('is reached by the arrow keys, between its neighbours', async () => {
    const { list, cherry, option } = await openList();

    fireEvent.keyDown(option('Apple'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(cherry));

    fireEvent.keyDown(cherry, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(option('Banana')));

    fireEvent.keyDown(option('Banana'), { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(cherry));
    expect(list.contains(cherry)).toBe(true);
  });

  it.each([
    ['Home', 'first'],
    ['End', 'last'],
  ] as const)('is reached by %s when it is %s in the list', async (key, cherryAt) => {
    const { cherry, option } = await openList(cherryAt);
    // Home is tried from the last option, End from the first.
    fireEvent.keyDown(option('Apple'), { key: key === 'Home' ? 'End' : 'Home' });
    await settled();

    fireEvent.keyDown(document.activeElement ?? cherry, { key });

    await waitFor(() => expect(document.activeElement).toBe(cherry));
  });

  it.each([
    ['Enter', (cherry: HTMLElement) => fireEvent.keyDown(cherry, { key: 'Enter' })],
    ['Space', (cherry: HTMLElement) => fireEvent.keyDown(cherry, { key: ' ' })],
    [
      'a mouse press',
      (cherry: HTMLElement) => {
        pointer(cherry, 'pointerdown', 'mouse');
        pointer(cherry, 'pointerup', 'mouse');
      },
    ],
    [
      'a touch',
      (cherry: HTMLElement) => {
        pointer(cherry, 'pointerdown', 'touch');
        fireEvent.click(cherry);
      },
    ],
  ] as const)('is not chosen by %s, and the list stays open', async (_name, choose) => {
    const { onValueChange, cherry } = await openList();
    cherry.focus();

    choose(cherry);
    await settled();

    expect(onValueChange.mock.calls).toEqual([]);
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  it('is not chosen by typing its first letter on the closed trigger', async () => {
    const onValueChange = vi.fn();
    await renderForm('en', <FruitSelect onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByTestId('trigger'), { key: 'c' });
    await settled();
    expect(onValueChange.mock.calls).toEqual([]);
  });

  it('leaves its neighbours to be chosen as before', async () => {
    const { onValueChange, option } = await openList();
    const banana = option('Banana');
    expect(banana.getAttribute('aria-disabled')).toBeNull();
    expect(descriptions(banana)).toEqual([]);
    banana.focus();

    fireEvent.keyDown(banana, { key: 'Enter' });

    await waitFor(() => expect(onValueChange.mock.calls).toEqual([['banana']]));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});
