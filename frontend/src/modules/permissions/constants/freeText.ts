/**
 * A field that can hold Latin, Arabic or mixed text on a page of either
 * direction. The field keeps the page direction, so its text and placeholder
 * stay at the page's start edge, and each typed line orders itself by its
 * first strong character. Do not set `dir` on a field that takes these.
 */
export const FREE_TEXT_FIELD_CLASSES = '[unicode-bidi:plaintext] ltr:text-left rtl:text-right';

/** The same for a `SearchBar`, whose `className` lands on the wrapper of the input. */
export const FREE_TEXT_SEARCH_CLASSES =
  '[&_input]:[unicode-bidi:plaintext] [&_input]:ltr:text-left [&_input]:rtl:text-right';
