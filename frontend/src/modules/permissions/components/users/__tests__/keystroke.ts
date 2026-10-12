import { fireEvent } from '@testing-library/react';

const CHAR_CODES = { Enter: 13, ' ': 32 } as const;
type Key = keyof typeof CHAR_CODES;

const focused = () => document.activeElement ?? document.body;

/**
 * One keystroke, a part at a time, so a test can let focus move between the
 * parts. Each part goes to whatever holds focus when it is sent, as in a
 * browser. jsdom has no activation behaviour, so the clicks a browser gives a
 * button are fired here: on an Enter keypress, and on a Space keyup when that
 * same button also saw the Space keydown. A cancelled part gives no click, and
 * a cancelled keydown gives no keypress.
 */
export function keystroke(key: Key) {
  let typing = false;
  let armed: Element | null = null;

  const down = (repeat: boolean) => {
    const target = focused();
    typing = fireEvent.keyDown(target, { key, repeat });
    if (typing && key === ' ' && target instanceof HTMLButtonElement) armed = target;
  };
  const press = (repeat: boolean) => {
    if (!typing) return;
    const target = focused();
    const typed = fireEvent.keyPress(target, { key, charCode: CHAR_CODES[key], repeat });
    if (typed && key === 'Enter' && target instanceof HTMLButtonElement) fireEvent.click(target);
  };

  return {
    down: () => down(false),
    press: () => press(false),
    /** What a held key adds before it comes up: another keydown and keypress. */
    repeat: () => {
      down(true);
      press(true);
    },
    /** The same from a keyboard that does not mark its repeats. */
    unmarkedRepeat: () => {
      down(false);
      press(false);
    },
    up: () => {
      const target = focused();
      const released = fireEvent.keyUp(target, { key });
      if (released && key === ' ' && target === armed) fireEvent.click(target);
    },
  };
}

/** A whole keystroke with nothing in between its parts. */
export function pressKey(key: Key): void {
  const stroke = keystroke(key);
  stroke.down();
  stroke.press();
  stroke.up();
}
