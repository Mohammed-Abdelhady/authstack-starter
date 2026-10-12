import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { TEST_ID } from '../constants';
import { useUi } from '../context/ui-context';
import { activityText, deviceText, kindText } from '../logic/session-text';
import { RADIUS, SIZE, SPACE } from '../theme/tokens';
import type { SessionRow } from '../types';
import { Button, BUTTON_VARIANT } from './Button';
import { Description, Label } from './Typography';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.MD },
  text: { flex: 1, gap: SPACE.XS },
  // This device is set apart by a surface and the same start-edge rule a notice carries.
  current: {
    padding: SPACE.LG,
    borderRadius: RADIUS.SURFACE,
    borderStartWidth: SIZE.EDGE_RULE,
  },
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
  const { t, locale, colors } = useUi();
  const device = deviceText(t, row.device);
  const kind = kindText(t, row.kind);
  const revoke = useCallback(() => onRevoke(row), [onRevoke, row]);

  return (
    <View
      testID={`${TEST_ID.SESSION_ROW}-${row.id}`}
      style={[
        styles.row,
        row.isCurrent && [
          styles.current,
          { backgroundColor: colors.surface, borderStartColor: colors.accent },
        ],
      ]}
    >
      <View accessible style={styles.text}>
        <Label>{device}</Label>
        <Description>{activityText(t, locale, row)}</Description>
        {kind === undefined ? null : <Description>{kind}</Description>}
        <Description>{t('sessions.address', { ip: row.ip })}</Description>
      </View>
      <Button
        testID={`${TEST_ID.SESSION_REVOKE}-${row.id}`}
        variant={BUTTON_VARIANT.DANGER}
        label={t('sessions.revoke')}
        accessibilityLabel={
          row.isCurrent ? t('account.signOut') : t('sessions.revokeLabel', { device })
        }
        accessibilityHint={row.isCurrent ? t('account.signOutHint') : undefined}
        busy={busy}
        onPress={revoke}
      />
    </View>
  );
});
