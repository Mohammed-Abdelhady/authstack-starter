import { StatusBar, StyleSheet, View } from 'react-native';
import { useTheme } from '../hooks/use-theme';
import type { Direction } from '../i18n';
import { SPACE } from '../theme/tokens';
import { ShellPaint } from './ShellPaint';
import { Body } from './Typography';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: { padding: SPACE.LG },
});

interface StartNoticeProps {
  text: string;
  direction: Direction;
  alert?: boolean;
  /** The safe area at the top, from the shell's own source. */
  topInset: number;
}

/** Shown before the screens exist, so it paints the whole window in the scheme's colours itself. */
export function StartNotice({ text, direction, alert = false, topInset }: StartNoticeProps) {
  const { colors, statusBarStyle } = useTheme();
  return (
    <ShellPaint direction={direction}>
      <View
        style={[
          styles.fill,
          { backgroundColor: colors.background, paddingTop: topInset, direction },
        ]}
      >
        <StatusBar barStyle={statusBarStyle} />
        <View
          accessible={alert}
          accessibilityRole={alert ? 'alert' : undefined}
          style={styles.notice}
        >
          <Body>{text}</Body>
        </View>
      </View>
    </ShellPaint>
  );
}
