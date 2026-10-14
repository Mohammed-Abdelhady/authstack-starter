import type { MessageArguments } from '../catalog/format-message';

/**
 * One block of a mail's HTML body, before a layout renders it. Catalogue copy
 * and outside values stay apart, so each layout decides what it escapes.
 */
export type MailBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | {
      readonly kind: 'paragraph';
      readonly message: string;
      /** Values from outside the catalogue, such as a name. */
      readonly args: MessageArguments;
    }
  | { readonly kind: 'code'; readonly code: string; readonly color: string }
  | { readonly kind: 'button'; readonly href: string; readonly label: string }
  | {
      readonly kind: 'linkFallback';
      readonly note: string;
      readonly href: string;
    }
  | {
      readonly kind: 'signOff';
      readonly signOff: string;
      readonly team: string;
    };
