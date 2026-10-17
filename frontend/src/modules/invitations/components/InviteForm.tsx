'use client';
// Requires editable fields, role queries, and invitation submission state.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { ErrorCode } from '@app/core';
import { errorBody, isRecord } from '@/modules/auth/utils/staffErrors';
import { INVITATION_CONFLICT_STATUS } from '../constants/invitations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormRootError } from '@/components/forms';
import { CreateUserRoleField } from '@/modules/permissions/components/users/CreateUserRoleField';
import { usePermission } from '@/modules/permissions/hooks/usePermission';
import { selectUser } from '@/modules/auth/store/authSlice';
import { useOperationKey } from '@/modules/auth/hooks/useOperationKey';
import type { CreateInvitation } from '../types/invitation.types';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_ROLE_SLUG } from '@/modules/roles/constants';
import { useAllRoles } from '@/modules/roles/hooks/useAllRoles';
import { showsOwnRefusal } from '@/lib/refusal';
import { useCreateInvitationMutation } from '../api/invitationsApi';
import { useInvitationOperation } from '../hooks/useInvitationOperation';
import { invitationErrorFields, invitationErrorKey } from '../utils/invitationErrors';
import { invitationRoles } from '../utils/invitationAccess';
import { FreshProofDialog } from './FreshProofDialog';

interface Props {
  onSuccess: () => void;
  onBusyChange: (busy: boolean) => void;
}

function useLogicalInvitation() {
  const actor = useAppSelector(selectUser);
  const generation = useAppSelector((state) => state.auth.sessionGeneration);
  const operationKey = useOperationKey();
  const logical = useRef<{
    signature: string;
    body: CreateInvitation;
    key: string;
    observeAgain: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      logical.current = null;
    },
    [],
  );
  const capture = (body: CreateInvitation) => {
    const signature = JSON.stringify([actor?.id, generation, body.email, body.name, body.role]);
    if (logical.current?.signature !== signature) {
      logical.current = { signature, body, key: operationKey.forBody(body), observeAgain: false };
    } else if (logical.current.observeAgain) {
      logical.current.body = body;
      logical.current.observeAgain = false;
    }
    return { body: logical.current.body, idempotencyKey: logical.current.key };
  };
  const refused = (error: unknown) => {
    if (!isRecord(error) || error.status !== INVITATION_CONFLICT_STATUS) return;
    if (error.unknownOutcome !== undefined && error.unknownOutcome !== false) return;
    if (errorBody(error).code === ErrorCode.CONFLICT && logical.current) {
      logical.current.observeAgain = true;
    }
  };
  return { capture, refused };
}

function useInviteForm({ onSuccess, onBusyChange }: Props) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState(DEFAULT_ROLE_SLUG);
  const allRoles = useAllRoles();
  const actorRole = useAppSelector(selectUser)?.role;
  const { permissions } = usePermission();
  const roles = invitationRoles(allRoles, actorRole, permissions);
  const [create] = useCreateInvitationMutation();
  const operation = useInvitationOperation();
  const logicalSubmit = useLogicalInvitation();
  const fields = invitationErrorFields(operation.error);
  const blocked = operation.busy || operation.methods !== null;
  const selectedRole = roles.roles.find((item) => item.slug === role);
  const selected =
    !roles.isError &&
    !roles.isLoading &&
    selectedRole !== undefined &&
    typeof selectedRole.id === 'string' &&
    selectedRole.id.length > 0 &&
    roles.refusalFor(selectedRole) === null;

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
      if (blocked || !selected || !selectedRole || !email.trim()) return;
      const submission = logicalSubmit.capture({
        expectedRoleId: selectedRole.id,
        expectedAudience: selectedRole.audience ?? null,
        email: email.trim(),
        role,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      void operation.start({
        run: async () => {
          onBusyChange(true);
          try {
            return await showsOwnRefusal(create(submission)).unwrap();
          } finally {
            onBusyChange(false);
          }
        },
        onSuccess,
        onError: logicalSubmit.refused,
      });
    },
    [
      blocked,
      create,
      email,
      name,
      onBusyChange,
      onSuccess,
      operation,
      role,
      selected,
      selectedRole,
      logicalSubmit,
    ],
  );

  return {
    id,
    email,
    name,
    role,
    roles,
    operation,
    fields,
    blocked,
    selected,
    changeEmail,
    changeName,
    setRole,
    submit,
  };
}

function InvitationIdentityFields({ model }: { model: ReturnType<typeof useInviteForm> }) {
  const t = useTranslations('invitations');
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${model.id}-email`}>{t('email')}</Label>
        <Input
          id={`${model.id}-email`}
          type="email"
          autoComplete="email"
          value={model.email}
          onChange={model.changeEmail}
          required
          dir="ltr"
          busy={model.blocked}
          aria-invalid={model.fields.includes('email')}
          aria-describedby={model.fields.includes('email') ? `${model.id}-email-error` : undefined}
          data-testid="invitation-email"
        />
        {model.fields.includes('email') && (
          <p id={`${model.id}-email-error`} role="alert">
            {t('errors.validation')}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${model.id}-name`}>{t('name')}</Label>
        <Input
          id={`${model.id}-name`}
          autoComplete="name"
          value={model.name}
          onChange={model.changeName}
          busy={model.blocked}
          aria-invalid={model.fields.includes('name')}
          aria-describedby={model.fields.includes('name') ? `${model.id}-name-error` : undefined}
          data-testid="invitation-name"
        />
        {model.fields.includes('name') && (
          <p id={`${model.id}-name-error`} role="alert">
            {t('errors.validation')}
          </p>
        )}
      </div>
    </>
  );
}

export function InviteForm({ onSuccess, onBusyChange }: Props) {
  const t = useTranslations('invitations');
  const model = useInviteForm({ onSuccess, onBusyChange });
  const { id, role, roles, operation, fields, blocked, selected, setRole, submit } = model;

  return (
    <>
      <form onSubmit={submit} className="space-y-4" data-testid="invitation-create-form">
        <FormRootError
          error={operation.error ? t(`errors.${invitationErrorKey(operation.error)}`) : null}
        />
        <InvitationIdentityFields model={model} />
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
          aria-busy={operation.busy}
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
