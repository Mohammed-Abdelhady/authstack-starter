import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { TEST_ID } from '../constants';
import { useUi } from '../context/ui-context';
import { activityText, deviceText, kindText } from '../logic/session-text';
import { SPACE } from '../theme/tokens';
import type { SessionRow } from '../types';
import { Button, BUTTON_VARIANT } from './Button';
import { Description, Label } from './Typography';
import { Surface } from './Surface';

const styles = StyleSheet.create({
  text: { gap: SPACE.XS },
});

interface SessionCardProps {
  row: SessionRow;
  onRevoke: (row: SessionRow) => void;
  /** True while this row's own sign-out is on its way. */
  busy?: boolean;
}

export const SessionCard = memo(function SessionCard({
  row,
  onRevoke,
  busy = false,
}: SessionCardProps) {
  const { t, locale } = useUi();
  const device = deviceText(t, row.device);
  const kind = kindText(t, row.kind);
  const revoke = useCallback(() => onRevoke(row), [onRevoke, row]);

  return (
    <Surface testID={`${TEST_ID.SESSION_ROW}-${row.id}`} compact accented={row.isCurrent}>
      <View accessible style={styles.text}>
        <Label>{device}</Label>
        <Description>{activityText(t, locale, row)}</Description>
        {kind === undefined ? null : <Description>{kind}</Description>}
        <Description>{t('sessions.address', { ip: row.ip })}</Description>
      </View>
      <Button
        testID={`${TEST_ID.SESSION_REVOKE}-${row.id}`}
        variant={BUTTON_VARIANT.DANGER}
        stretch
        label={t('sessions.revoke')}
        accessibilityLabel={
          row.isCurrent ? t('account.signOut') : t('sessions.revokeLabel', { device })
        }
        accessibilityHint={row.isCurrent ? t('account.signOutHint') : undefined}
        busy={busy}
        onPress={revoke}
      />
    </Surface>
  );
});
