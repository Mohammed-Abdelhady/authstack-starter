import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Screen } from './Screen';
import { SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, gap: SPACE.XL, paddingBottom: SPACE.XL },
  group: { gap: SPACE.MD },
});
export function NativeFormLayout({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <View style={styles.group}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
