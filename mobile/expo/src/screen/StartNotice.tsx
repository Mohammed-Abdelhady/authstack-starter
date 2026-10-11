import { useTheme } from '@app/native-ui/theme';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Direction } from '../i18n/messages';

const PADDING = 16;
const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: { padding: PADDING },
});

interface StartNoticeProps {
  text: string;
  direction: Direction;
}

/** Shown before the screens exist, so it paints the whole window in the scheme's colours itself. */
export function StartNotice({ text, direction }: StartNoticeProps) {
  const { top } = useSafeAreaInsets();
  const { colors, statusBarStyle } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={statusBarStyle} />
      <Text
        style={[styles.notice, { marginTop: top, color: colors.text, writingDirection: direction }]}
      >
        {text}
      </Text>
    </View>
  );
}
