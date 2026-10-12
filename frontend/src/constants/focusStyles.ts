/**
 * Focus styles shared by every interactive element.
 *
 * The design system asks for one ring: 2px in the ring token, offset by 2px
 * against the page background. Anything that removes the browser outline has to
 * pull these classes in, otherwise keyboard users lose the focus indicator.
 */
export const FOCUS_RING_CLASSES =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * For a heading that takes focus from code: after a removal, or when the
 * control that had the focus was replaced. It gets the same ring as a control
 * and not the browser's own outline. Give the heading `tabIndex={-1}`.
 */
export const FOCUS_LANDING_CLASSES = `rounded-sm ${FOCUS_RING_CLASSES}`;

/**
 * Reveal pattern for controls that are hidden until hover. They also show up on
 * keyboard focus inside the group, and stay visible on touch pointers where
 * hover never happens.
 */
export const HOVER_REVEAL_CLASSES =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100';
