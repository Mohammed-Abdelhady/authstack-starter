import { createApiClient } from '@app/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DELETION_RECHECK_WAIT_MS, DELETION_VIEW } from '../constants/account-deletion';
import { useUi } from '../context/ui-context';
import type { MessageKey } from '../i18n';
import type { AccountDeletionProps } from '../types/account-deletion';
import { useEngineSnapshot } from './use-engine-snapshot';

type View = (typeof DELETION_VIEW)[keyof typeof DELETION_VIEW];

export function useDeletionContext({
  randomBytes,
  receipts,
  onDeleted,
  receiptTransport,
}: AccountDeletionProps) {
  const ui = useUi();
  useEngineSnapshot(ui.runtime.engine);
  const accountEpoch = ui.runtime.epoch.current();
  const owner = useRef(accountEpoch);
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
  const active = useCallback(
    (run: number) => epoch.current === run && ui.runtime.epoch.current() === owner.current,
    [ui.runtime],
  );

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

  return {
    ui,
    client,
    receiptClient,
    latest,
    view,
    setView,
    notice,
    setNotice,
    eraseAfter,
    setEraseAfter,
    epoch,
    busy,
    key,
    notified,
    confirmed,
    active,
    wait,
    receipts,
    accountEpoch,
    owner,
    cancelWait,
  };
}
