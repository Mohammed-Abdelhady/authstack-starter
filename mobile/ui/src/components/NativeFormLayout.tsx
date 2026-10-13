import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Screen } from './Screen';
import { Surface } from './Surface';
import { SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, gap: SPACE.XL, paddingBottom: SPACE.XL },
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
          <Surface>{children}</Surface>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
