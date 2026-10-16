import {
  createApiClient,
  deletionReceiptKey,
  DELETION_RECEIPT_RANDOM_BYTES,
  DELETION_RECEIPT_STATE,
} from '@app/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DELETION_RECHECK_WAIT_MS, DELETION_VIEW } from '../constants/account-deletion';
import { useUi } from '../context/ui-context';
import type { MessageKey } from '../i18n';
import { deletionRefusal } from '../logic/account-deletion';
import type { AccountDeletionProps } from '../types/account-deletion';

type View = (typeof DELETION_VIEW)[keyof typeof DELETION_VIEW];

export function useAccountDeletion({
  randomBytes,
  receipts,
  onDeleted,
  receiptTransport,
}: AccountDeletionProps) {
  const ui = useUi();
  const client = useMemo(() => createApiClient(ui.runtime.engine.transport), [ui.runtime]);
  const receiptClient = useMemo(() => createApiClient(receiptTransport), [receiptTransport]);
  const latest = useRef({ ui, randomBytes, onDeleted });
  useEffect(() => {
    latest.current = { ui, randomBytes, onDeleted };
  });
  const [view, setView] = useState<View>(DELETION_VIEW.CHECKING);
  const [notice, setNotice] = useState<MessageKey>();
  const [eraseAfter, setEraseAfter] = useState<string>();
  const epoch = useRef(0);
  const busy = useRef(true);
  const key = useRef<string | null>(null);
  const notified = useRef(false);
  const confirmed = useRef(false);
  const cancelWait = useRef<(() => void) | undefined>(undefined);
  const active = useCallback((run: number) => epoch.current === run, []);

  const wait = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          cancelWait.current = undefined;
          resolve(true);
        }, DELETION_RECHECK_WAIT_MS);
        cancelWait.current = () => {
          clearTimeout(timer);
          resolve(false);
        };
      }),
    [],
  );

  const finish = useCallback(
    async (run: number, message: MessageKey, deleted = false, date?: string) => {
      if (!active(run)) return;
      if (deleted) confirmed.current = true;
      try {
        await receipts.clear();
        if (!active(run)) return;
        key.current = null;
      } catch {
        if (!active(run)) return;
        if (!deleted) {
          setView(DELETION_VIEW.UNRESOLVED);
          setNotice('deletion.pending');
          return;
        }
      }
      if (!active(run)) return;
      setNotice(message);
      setEraseAfter(date);
      setView(deleted ? DELETION_VIEW.DELETED : DELETION_VIEW.READY);
      if (deleted && !notified.current) {
        notified.current = true;
        latest.current.onDeleted();
      }
    },
    [active, receipts],
  );

  const check = useCallback(
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
          await finish(run, 'deletion.deleted', true);
        } else {
          await finish(
            run,
            result.state === DELETION_RECEIPT_STATE.UNKNOWN
              ? 'deletion.unknown'
              : 'deletion.notDeleted',
          );
        }
      } catch {
        if (active(run) && !confirmed.current) {
          setView(DELETION_VIEW.UNRESOLVED);
          setNotice('deletion.pending');
        }
      }
    },
    [active, finish, receiptClient, wait],
  );

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
    [active, check, receipts],
  );

  useEffect(() => {
    const run = ++epoch.current;
    busy.current = true;
    setView(DELETION_VIEW.CHECKING);
    void restore(run);
    return () => {
      epoch.current += 1;
      cancelWait.current?.();
      cancelWait.current = undefined;
    };
  }, [restore]);

  const remove = useCallback(async () => {
    if (busy.current || key.current !== null || confirmed.current) return;
    busy.current = true;
    const run = epoch.current;
    try {
      const { t, confirm, now } = latest.current.ui;
      const accepted = await confirm({
        title: t('deletion.confirmTitle'),
        message: t('deletion.confirmMessage'),
        confirmLabel: t('deletion.delete'),
        cancelLabel: t('common.cancel'),
      });
      if (!accepted || !active(run)) return;
      setNotice(undefined);
      setView(DELETION_VIEW.DELETING);
      let receiptKey: string;
      try {
        receiptKey = deletionReceiptKey(
          now(),
          await latest.current.randomBytes(DELETION_RECEIPT_RANDOM_BYTES),
        );
        if (!active(run)) return;
        await receipts.write(receiptKey);
        if (!active(run)) return;
        key.current = receiptKey;
      } catch {
        if (active(run)) {
          setView(DELETION_VIEW.READY);
          setNotice('deletion.storageFailed');
        }
        return;
      }
      try {
        const result = await client.accountDeletion.delete({ receiptKey });
        await finish(run, 'deletion.deleted', true, result.eraseAfter);
      } catch (error) {
        if (!active(run) || confirmed.current) return;
        const refusal = deletionRefusal(error);
        if (refusal !== undefined) await finish(run, refusal);
        else await check(receiptKey, run);
      }
    } catch {
      if (active(run)) {
        setView(DELETION_VIEW.READY);
        setNotice('deletion.failed');
      }
    } finally {
      if (active(run)) busy.current = false;
    }
  }, [active, check, client, finish, receipts]);

  const retry = useCallback(async () => {
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
  }, [active, check, restore]);

  return {
    view,
    notice,
    eraseAfter,
    canDelete: view === DELETION_VIEW.READY,
    remove: useCallback(() => void remove(), [remove]),
    retry: useCallback(() => void retry(), [retry]),
  };
}
