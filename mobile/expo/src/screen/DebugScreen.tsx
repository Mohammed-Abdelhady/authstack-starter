import { useTheme } from '@app/native-ui/theme';
import { Button, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import type { StartedShellAuth } from '../shell';
import { DIRECTION, translate, type Locale, type MessageKey } from '../i18n/messages';
import { OPERATION_KEY, REASON_KEY, STATUS_KEY, STORAGE_WARNING_KEY } from '../logic/outcome-keys';
import { render } from '../logic/outcome-text';
import { useAuthDebug } from './use-auth-debug';
import { describeDeviceKey } from '../logic/device-key-text';

export const TEST_ID = {
  STATUS: 'auth-status',
  DEVICE_KEY: 'auth-device-key',
  OPERATION: 'auth-operation',
  WARNING: 'auth-warning',
  LAST_OUTCOME: 'auth-last-outcome',
  REFRESH_TOKEN_REQUESTS: 'auth-refresh-token-requests',
  SIGN_IN: 'auth-sign-in',
  REFRESH: 'auth-refresh',
  LOAD_PROFILE: 'auth-load-profile',
  SIGN_OUT: 'auth-sign-out',
  CLOSE: 'auth-close',
} as const;

const SPACING = 16;
const TOP_INSET = 64;

const styles = StyleSheet.create({
  content: { gap: SPACING, padding: SPACING, paddingTop: TOP_INSET },
});

interface DebugScreenProps {
  auth: StartedShellAuth;
  locale: Locale;
  onClose: () => void;
}

export function DebugScreen({ auth, locale, onClose }: DebugScreenProps) {
  const {
    snapshot,
    lastOutcome,
    storageWarning,
    refreshTokenRequests,
    signIn,
    refresh,
    loadProfile,
    signOut,
  } = useAuthDebug(auth);
  const { colors, statusBarStyle } = useTheme();
  const direction = DIRECTION[locale];
  const text = (key: MessageKey, value?: string): string => translate(locale, key, value);
  const none = text('none');
  const keyState = describeDeviceKey(locale, auth.deviceKey);
  const line = { writingDirection: direction, color: colors.text } as const;
  const reason = snapshot.reason === undefined ? none : text(REASON_KEY[snapshot.reason]);
  const warning =
    snapshot.warning === undefined || storageWarning === undefined
      ? undefined
      : text(STORAGE_WARNING_KEY[storageWarning]);
  const outcome = lastOutcome === undefined ? none : render(locale, lastOutcome);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { direction }]}
    >
      <StatusBar barStyle={statusBarStyle} />
      <Text accessibilityRole="header" style={line}>
        {text('title')}
      </Text>
      <View>
        <Text testID={TEST_ID.STATUS} style={line}>
          {text('status', text(STATUS_KEY[snapshot.status]))}
        </Text>
        <Text testID={TEST_ID.DEVICE_KEY} style={line}>
          {text('deviceKey', keyState)}
        </Text>
        <Text testID={TEST_ID.OPERATION} style={line}>
          {text('operation', text(OPERATION_KEY[snapshot.operation]))}
        </Text>
        <Text style={line}>{text('reason', reason)}</Text>
        <Text style={line}>{text('account', snapshot.profile?.email ?? none)}</Text>
        {warning === undefined ? null : (
          <Text testID={TEST_ID.WARNING} style={line}>
            {text('warning', warning)}
          </Text>
        )}
        <Text testID={TEST_ID.LAST_OUTCOME} style={line}>
          {text('lastOutcome', outcome)}
        </Text>
        <Text testID={TEST_ID.REFRESH_TOKEN_REQUESTS} style={line}>
          {text('refreshTokenRequests', String(refreshTokenRequests))}
        </Text>
      </View>
      <Button
        testID={TEST_ID.SIGN_IN}
        title={text('signIn')}
        accessibilityLabel={text('signInLabel')}
        onPress={signIn}
      />
      <Button
        testID={TEST_ID.REFRESH}
        title={text('refresh')}
        accessibilityLabel={text('refreshLabel')}
        onPress={refresh}
      />
      <Button
        testID={TEST_ID.LOAD_PROFILE}
        title={text('loadProfile')}
        accessibilityLabel={text('loadProfileLabel')}
        onPress={loadProfile}
      />
      <Button
        testID={TEST_ID.SIGN_OUT}
        title={text('signOut')}
        accessibilityLabel={text('signOutLabel')}
        onPress={signOut}
      />
      <Button
        testID={TEST_ID.CLOSE}
        title={text('close')}
        accessibilityLabel={text('closeLabel')}
        onPress={onClose}
      />
    </ScrollView>
  );
}
