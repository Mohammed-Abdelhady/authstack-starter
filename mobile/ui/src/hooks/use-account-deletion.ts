import {
  deletionReceiptKey,
  DELETION_RECEIPT_RANDOM_BYTES,
  DELETION_RECEIPT_STATE,
} from '@app/sdk';
import { useCallback, useEffect } from 'react';
import { DELETION_VIEW } from '../constants/account-deletion';
import { useDeletionProof } from './use-deletion-proof';
import { useDeletionContext } from './use-deletion-context';
import { deleteAccountWithProof } from '../logic/delete-account-with-proof';
import type { MessageKey } from '../i18n';
import { deletionRefusal } from '../logic/account-deletion';
import type { AccountDeletionProps } from '../types/account-deletion';

type DeletionContext = ReturnType<typeof useDeletionContext>;

async function clearDeletionReceipt(
  context: Pick<DeletionContext, 'active' | 'receipts' | 'key' | 'setView' | 'setNotice'>,
  run: number,
  deleted: boolean,
) {
  const { active, receipts, key, setView, setNotice } = context;
  try {
    await receipts.clear();
    if (!active(run)) return false;
    key.current = null;
  } catch {
    if (!active(run)) return false;
    if (!deleted) {
      setView(DELETION_VIEW.UNRESOLVED);
      setNotice('deletion.pending');
      return false;
    }
  }
  return active(run);
}

function notYetConfirmed(
  context: Pick<DeletionContext, 'active' | 'confirmed'>,
  run: number,
): boolean {
  return context.active(run) && !context.confirmed.current;
}

function useDeletionFinish(context: DeletionContext) {
  const { active, confirmed, receipts, key, setView, setNotice, setEraseAfter, notified, latest } =
    context;
  return useCallback(
    async (
      run: number,
      message: MessageKey,
      outcome: { deleted?: boolean; date?: string } = {},
    ) => {
      const { deleted = false, date } = outcome;
      if (!active(run)) return;
      if (deleted) confirmed.current = true;
      if (
        !(await clearDeletionReceipt({ active, receipts, key, setView, setNotice }, run, deleted))
      )
        return;
      setNotice(message);
      setEraseAfter(date);
      setView(deleted ? DELETION_VIEW.DELETED : DELETION_VIEW.READY);
      if (deleted && !notified.current) {
        notified.current = true;
        latest.current.onDeleted();
      }
    },
    [active, receipts, key, confirmed, setView, setNotice, setEraseAfter, notified, latest],
  );
}

function useDeletionCheck({
  context,
  finish,
}: {
  context: DeletionContext;
  finish: ReturnType<typeof useDeletionFinish>;
}) {
  const { setView, receiptClient, active, wait, setNotice, confirmed } = context;
  return useCallback(
    async (receiptKey: string, run: number) => {
      setView(DELETION_VIEW.CHECKING);
      try {
        let result = await receiptClient.accountDeletion.receipt(receiptKey);
        if (!active(run)) return;
        if (result.state === DELETION_RECEIPT_STATE.NOT_RECORDED) {
          if (!(await wait()) || !active(run)) return;
          result = await receiptClient.accountDeletion.receipt(receiptKey);
        }
        if (!active(run)) return;
        if (result.state === DELETION_RECEIPT_STATE.RECORDED) {
          await finish(run, 'deletion.deleted', { deleted: true });
        } else {
          await finish(
            run,
            result.state === DELETION_RECEIPT_STATE.UNKNOWN
              ? 'deletion.unknown'
              : 'deletion.notDeleted',
          );
        }
      } catch {
        if (notYetConfirmed({ active, confirmed }, run)) {
          setView(DELETION_VIEW.UNRESOLVED);
          setNotice('deletion.pending');
        }
      }
    },
    [active, confirmed, finish, receiptClient, wait, setView, setNotice],
  );
}

function useDeletionRestore({
  context,
  check,
}: {
  context: DeletionContext;
  check: ReturnType<typeof useDeletionCheck>;
}) {
  const {
    receipts,
    active,
    key,
    setView,
    setNotice,
    busy,
    epoch,
    cancelWait,
    owner,
    accountEpoch,
  } = context;
  const restore = useCallback(
    async (run: number) => {
      try {
        const stored = await receipts.read();
        if (!active(run)) return;
        key.current = stored;
        if (stored !== null) await check(stored, run);
        else setView(DELETION_VIEW.READY);
      } catch {
        if (active(run)) {
          setView(DELETION_VIEW.STORAGE_ERROR);
          setNotice('deletion.storageFailed');
        }
      } finally {
        if (active(run)) busy.current = false;
      }
    },
    [active, check, receipts, key, setView, setNotice, busy],
  );

  useEffect(() => {
    const run = ++epoch.current;
    owner.current = accountEpoch;
    busy.current = true;
    setView(DELETION_VIEW.CHECKING);
    void restore(run);
    return () => {
      epoch.current += 1;
      cancelWait.current?.();
      cancelWait.current = undefined;
    };
  }, [restore, accountEpoch, owner, epoch, busy, setView, cancelWait]);

  return restore;
}

async function prepareDeletionReceipt(context: DeletionContext, run: number) {
  const { active, latest, receipts, key, setView, setNotice } = context;
  try {
    const receiptKey = deletionReceiptKey(
      latest.current.ui.now(),
      await latest.current.randomBytes(DELETION_RECEIPT_RANDOM_BYTES),
    );
    if (!active(run)) return undefined;
    await receipts.write(receiptKey);
    if (!active(run)) return undefined;
    key.current = receiptKey;
    return receiptKey;
  } catch {
    if (active(run)) {
      setView(DELETION_VIEW.READY);
      setNotice('deletion.storageFailed');
    }
    return undefined;
  }
}

function useDeletionSubmit({
  context,
  finish,
  check,
  proof,
}: {
  context: DeletionContext;
  finish: ReturnType<typeof useDeletionFinish>;
  check: ReturnType<typeof useDeletionCheck>;
  proof: ReturnType<typeof useDeletionProof>;
}) {
  const { client, active, confirmed } = context;
  return useCallback(
    async (receiptKey: string, run: number) => {
      try {
        const result = await deleteAccountWithProof({
          client,
          receiptKey,
          authorize: proof.authorize,
          isCurrent: () => active(run),
        });
        if (!active(run)) return;
        if (result === undefined) {
          await finish(run, 'deletion.proofRequired');
          return;
        }
        await finish(run, 'deletion.deleted', {
          deleted: true,
          ...(result.eraseAfter === undefined ? {} : { date: result.eraseAfter }),
        });
      } catch (error) {
        if (!active(run) || confirmed.current) return;
        const refusal = deletionRefusal(error);
        if (refusal !== undefined) await finish(run, refusal);
        else await check(receiptKey, run);
      }
    },
    [active, check, client, confirmed, finish, proof.authorize],
  );
}

function useDeletionRemoval({
  context,
  submit,
}: {
  context: DeletionContext;
  submit: ReturnType<typeof useDeletionSubmit>;
}) {
  const { busy, key, confirmed, epoch, latest, active, setNotice, setView } = context;
  return useCallback(async () => {
    if (busy.current || key.current !== null || confirmed.current) return;
    busy.current = true;
    const run = epoch.current;
    try {
      const { t, confirm } = latest.current.ui;
      const accepted = await confirm({
        title: t('deletion.confirmTitle'),
        message: t('deletion.confirmMessage'),
        confirmLabel: t('deletion.delete'),
        cancelLabel: t('common.cancel'),
      });
      if (!accepted || !active(run)) return;
      setNotice(undefined);
      setView(DELETION_VIEW.DELETING);
      const receiptKey = await prepareDeletionReceipt(context, run);
      if (receiptKey !== undefined) await submit(receiptKey, run);
    } catch {
      if (active(run)) {
        setView(DELETION_VIEW.READY);
        setNotice('deletion.failed');
      }
    } finally {
      if (active(run)) busy.current = false;
    }
  }, [active, busy, key, confirmed, epoch, latest, setNotice, setView, context, submit]);
}

function useDeletionRetry({
  context,
  check,
  restore,
}: {
  context: DeletionContext;
  check: ReturnType<typeof useDeletionCheck>;
  restore: ReturnType<typeof useDeletionRestore>;
}) {
  const { busy, confirmed, epoch, key, active, setView } = context;
  return useCallback(async () => {
    if (busy.current || confirmed.current) return;
    busy.current = true;
    const run = epoch.current;
    try {
      if (key.current !== null) await check(key.current, run);
      else {
        setView(DELETION_VIEW.CHECKING);
        await restore(run);
      }
    } finally {
      if (active(run)) busy.current = false;
    }
  }, [active, check, restore, busy, confirmed, epoch, key, setView]);
}

export function useAccountDeletion(props: AccountDeletionProps) {
  const context = useDeletionContext(props);
  const proof = useDeletionProof(context.client);
  const finish = useDeletionFinish(context);
  const check = useDeletionCheck({ context, finish });
  const restore = useDeletionRestore({ context, check });
  const submit = useDeletionSubmit({ context, finish, check, proof });
  const remove = useDeletionRemoval({ context, submit });
  const retry = useDeletionRetry({ context, check, restore });
  return {
    view: context.view,
    notice: context.notice,
    eraseAfter: context.eraseAfter,
    canDelete: context.view === DELETION_VIEW.READY,
    proof,
    remove: useCallback(() => void remove(), [remove]),
    retry: useCallback(() => void retry(), [retry]),
  };
}
