import { describe, expect, it } from 'vitest';
import { validateCreateUserForm } from '../createUserValidation';

const mockTranslator = (key: string): string => key;

describe('validateCreateUserForm', () => {
  it('returns errors for empty fields', () => {
    const errors = validateCreateUserForm(
      { email: '', name: '', password: '', role: '' },
      mockTranslator,
      mockTranslator,
    );

    expect(errors.email).toBe('emailRequired');
    expect(errors.name).toBe('nameRequired');
    expect(errors.password).toBe('required');
    expect(errors.role).toBe('roleRequired');
  });

  it('validates invalid email format', () => {
    const errors = validateCreateUserForm(
      { email: 'invalid-email', name: 'Valid Name', password: 'Password1!', role: 'user' },
      mockTranslator,
      mockTranslator,
    );

    expect(errors.email).toBe('emailInvalid');
  });

  it('validates short name', () => {
    const errors = validateCreateUserForm(
      { email: 'user@example.com', name: 'A', password: 'Password1!', role: 'user' },
      mockTranslator,
      mockTranslator,
    );

    expect(errors.name).toBe('nameMinLength');
  });
});
