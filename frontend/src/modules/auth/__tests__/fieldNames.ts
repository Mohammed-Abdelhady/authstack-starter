/**
 * The names of the fields a person can fill in on a form, in page order. A
 * hidden field, such as the username a password manager reads, is left out.
 */
export function fieldNames(form: HTMLElement): string[] {
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('fieldNames needs a form element');
  }
  return Array.from(form.elements).flatMap((control) =>
    control instanceof HTMLInputElement && control.name !== '' && !control.hidden
      ? [control.name]
      : [],
  );
}
