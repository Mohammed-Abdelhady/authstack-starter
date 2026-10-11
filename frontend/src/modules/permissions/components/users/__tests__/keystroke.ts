import { fireEvent } from '@testing-library/react';

const CHAR_CODES = { Enter: 13, ' ': 32 } as const;

/**
 * One keystroke as a browser delivers it: keydown to the focused element, then
 * keypress and keyup to whatever holds focus by then. jsdom has no activation
 * behaviour, so the click a button receives from an Enter keypress is fired
 * here. Space only presses the button that also saw its keydown, so a button
 * focused midway gets no click from it.
 */
export function pressKey(key: keyof typeof CHAR_CODES): void {
  const focused = () => document.activeElement ?? document.body;
  const keydownTarget = focused();

  if (fireEvent.keyDown(keydownTarget, { key })) {
    const receiver = focused();
    const typed = fireEvent.keyPress(receiver, { key, charCode: CHAR_CODES[key] });
    if (typed && key === 'Enter' && receiver instanceof HTMLButtonElement) {
      fireEvent.click(receiver);
    }
  }

  const keyupTarget = focused();
  fireEvent.keyUp(keyupTarget, { key });
  if (key === ' ' && keyupTarget === keydownTarget && keyupTarget instanceof HTMLButtonElement) {
    fireEvent.click(keyupTarget);
  }
}
