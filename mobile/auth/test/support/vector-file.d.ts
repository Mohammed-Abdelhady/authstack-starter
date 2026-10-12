/** A file's text, as the test runner hands it over for a `?raw` import. */
declare module '*?raw' {
  const text: string;
  export default text;
}

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}
