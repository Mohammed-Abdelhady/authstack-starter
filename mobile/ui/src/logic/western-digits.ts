const OTHER_SCRIPT_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/gu;
const FIRST_ZERO = 0x0660;
const SECOND_ZERO = 0x06f0;

/**
 * A keyboard may type a mailed code in another script's digits, U+0660 to U+0669 or
 * U+06F0 to U+06F9. Each reads as the Western digit the mail shows and the server takes.
 */
export function westernDigits(value: string): string {
  return value.replace(OTHER_SCRIPT_DIGITS, (digit) => {
    const point = digit.codePointAt(0) ?? FIRST_ZERO;
    return String(point - (point >= SECOND_ZERO ? SECOND_ZERO : FIRST_ZERO));
  });
}
