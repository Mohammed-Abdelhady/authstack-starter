/**
 * For text the server sends that a person typed: a name, a description, a
 * device name. A long run with no space breaks inside its box and does not
 * push the page sideways. `min-w-0` lets a flex or grid child shrink to do so.
 */
export const WRAP_ANYWHERE_CLASSES = 'min-w-0 [overflow-wrap:anywhere]';
