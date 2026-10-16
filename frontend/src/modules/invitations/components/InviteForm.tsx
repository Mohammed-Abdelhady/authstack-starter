'use client';
// Requires editable fields, role queries, and invitation submission state.

import { useCallback, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormRootError } from '@/components/forms';
import { CreateUserRoleField } from '@/modules/permissions/components/users/CreateUserRoleField';
import { DEFAULT_ROLE_SLUG } from '@/modules/roles/constants';
import { useAllRoles } from '@/modules/roles/hooks/useAllRoles';
import { showsOwnRefusal } from '@/lib/refusal';
import { useCreateInvitationMutation } from '../api/invitationsApi';
import { useInvitationOperation } from '../hooks/useInvitationOperation';
import { invitationErrorFields, invitationErrorKey } from '../utils/invitationErrors';
import { FreshProofDialog } from './FreshProofDialog';

interface Props {
  onSuccess: () => void;
  onBusyChange: (busy: boolean) => void;
}

export function InviteForm({ onSuccess, onBusyChange }: Props) {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const id = useId();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState(DEFAULT_ROLE_SLUG);
  const roles = useAllRoles();
  const [create] = useCreateInvitationMutation();
  const operation = useInvitationOperation();
  const logicalSubmit = useRef<{ signature: string; key: string } | null>(null);
  const fields = invitationErrorFields(operation.error);
  const blocked = operation.busy || operation.methods !== null;
  const selectedRole = roles.roles.find((item) => item.slug === role);
  const selected = selectedRole !== undefined && roles.refusalFor(selectedRole) === null;

  const changeEmail = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value),
    [],
  );
  const changeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (blocked || !selected || !email.trim()) return;
      const body = {
        email: email.trim(),
        role,
        ...(name.trim() ? { name: name.trim() } : {}),
        locale,
      };
      const signature = JSON.stringify(body);
      if (logicalSubmit.current?.signature !== signature) {
        logicalSubmit.current = { signature, key: crypto.randomUUID() };
      }
      const idempotencyKey = logicalSubmit.current.key;
      void operation.start({
        run: async () => {
          onBusyChange(true);
          try {
            return await showsOwnRefusal(create({ body, idempotencyKey })).unwrap();
          } finally {
            onBusyChange(false);
          }
        },
        onSuccess,
      });
    },
    [blocked, create, email, locale, name, onBusyChange, onSuccess, operation, role, selected],
  );

  return (
    <>
      <form onSubmit={submit} className="space-y-4" data-testid="invitation-create-form">
        <FormRootError
          error={operation.error ? t(`errors.${invitationErrorKey(operation.error)}`) : null}
        />
        <div className="space-y-2">
          <Label htmlFor={`${id}-email`}>{t('email')}</Label>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={changeEmail}
            required
            dir="ltr"
            busy={blocked}
            aria-invalid={fields.includes('email')}
            aria-describedby={fields.includes('email') ? `${id}-email-error` : undefined}
            data-testid="invitation-email"
          />
          {fields.includes('email') && (
            <p id={`${id}-email-error`} role="alert">
              {t('errors.validation')}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>{t('name')}</Label>
          <Input
            id={`${id}-name`}
            autoComplete="name"
            value={name}
            onChange={changeName}
            busy={blocked}
            aria-invalid={fields.includes('name')}
            aria-describedby={fields.includes('name') ? `${id}-name-error` : undefined}
            data-testid="invitation-name"
          />
          {fields.includes('name') && (
            <p id={`${id}-name-error`} role="alert">
              {t('errors.validation')}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-role`}>{t('role')}</Label>
          <CreateUserRoleField
            id={`${id}-role`}
            value={role}
            onChange={setRole}
            allRoles={roles}
            busy={blocked}
            errorId={fields.includes('role') ? `${id}-role-error` : undefined}
          />
          {fields.includes('role') && (
            <p id={`${id}-role-error`} role="alert">
              {t('errors.validation')}
            </p>
          )}
        </div>
        <Button
          type="submit"
          busy={blocked}
          disabled={!selected || roles.isError}
          data-testid="invitation-create-submit"
        >
          {t('invite')}
        </Button>
      </form>
      {operation.methods && (
        <FreshProofDialog
          methods={operation.methods}
          onProved={operation.proved}
          onCancel={operation.cancelProof}
        />
      )}
    </>
  );
}
