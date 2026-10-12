/**
 * Typography roles for headings and descriptions. A role fixes size, weight,
 * tracking, line height and colour. Spacing belongs to the call site.
 */

// feature:locale-ar:start
// Letter spacing breaks the joins of Arabic script, so every role resets it.
// feature:locale-ar:end
const EYEBROW_LOCALE_CLASSES =
  // feature:locale-ar:start
  'rtl:text-sm rtl:font-semibold rtl:tracking-normal' +
  // feature:locale-ar:end
  '';

const TIGHT_TRACKING = 'tracking-tight rtl:tracking-normal';

export const HEADING_ROLE_CLASSES = {
  display: `text-2xl xl:text-3xl font-extrabold leading-tight ${TIGHT_TRACKING} text-foreground`,
  pageTitle: `text-2xl font-semibold leading-tight ${TIGHT_TRACKING} text-foreground`,
  sectionTitle: `text-lg font-semibold leading-snug ${TIGHT_TRACKING} text-foreground`,
  subsectionTitle: `text-sm font-semibold leading-snug ${TIGHT_TRACKING} text-foreground`,
  eyebrow: `text-xs font-medium uppercase tracking-widest text-tertiary ${EYEBROW_LOCALE_CLASSES}`,
} as const;

export const DESCRIPTION_ROLE_CLASSES = {
  description: 'text-sm text-muted-foreground',
  lead: 'text-base text-muted-foreground',
} as const;

export type HeadingVariant = keyof typeof HEADING_ROLE_CLASSES;
export type DescriptionVariant = keyof typeof DESCRIPTION_ROLE_CLASSES;
