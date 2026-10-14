import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { readMailLinkTemplates } from './mail-link-templates';

/** A link setting names only mails with a link, and gives each a URL. */
@ValidatorConstraint({ name: 'mailLinkTemplates' })
export class MailLinkTemplatesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    return (
      readMailLinkTemplates(value, validation.property).problem === undefined
    );
  }

  defaultMessage(validation: ValidationArguments): string {
    return (
      readMailLinkTemplates(validation.value, validation.property).problem ?? ''
    );
  }
}
