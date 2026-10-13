import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePaint } from '../context/paint-context';
import { RADIUS, SIZE, SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  surface: {
    padding: SPACE.XL,
    gap: SPACE.LG,
    borderWidth: SIZE.BORDER,
    borderRadius: RADIUS.SURFACE,
  },
  compact: { padding: SPACE.LG },
  accented: { borderStartWidth: SIZE.EDGE_RULE },
});

export function Surface({
  children,
  compact = false,
  accented = false,
  testID,
}: {
  children: ReactNode;
  compact?: boolean;
  accented?: boolean;
  testID?: string;
}) {
  const { colors } = usePaint();
  return (
    <View
      testID={testID}
      style={[
        styles.surface,
        compact && styles.compact,
        accented && styles.accented,
        { backgroundColor: colors.surface, borderColor: colors.separator },
        accented && { borderStartColor: colors.accent },
      ]}
    >
      {children}
    </View>
  );
}
