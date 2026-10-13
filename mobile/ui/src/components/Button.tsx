import { useCallback, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { usePaint } from '../context/paint-context';
import { usePressMotion } from '../hooks/use-press-motion';
import { OPACITY, RADIUS, SIZE, SPACE, TRANSPARENT } from '../theme/tokens';
import type { LabelTone, Palette } from '../types/theme';
import { Label } from './Typography';
import { BUTTON_VARIANT } from '../constants/button';
import type { ButtonVariant } from '../types/button';

export { BUTTON_VARIANT } from '../constants/button';

interface VariantColors {
  fill?: keyof Palette;
  edge?: keyof Palette;
  label: LabelTone;
}

const VARIANT: Record<ButtonVariant, VariantColors> = {
  primary: { fill: 'accent', edge: 'accent', label: 'onAccent' },
  secondary: { fill: 'secondary', edge: 'secondary', label: 'onSecondary' },
  danger: { fill: 'danger', edge: 'danger', label: 'onDanger' },
  outline: { fill: 'background', edge: 'border', label: 'text' },
  link: { label: 'accent' },
};

const styles = StyleSheet.create({
  ring: { borderWidth: SIZE.FOCUS_RING, borderRadius: RADIUS.CONTROL + SIZE.FOCUS_RING },
  stretch: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  face: {
    minHeight: SIZE.TARGET_MIN,
    minWidth: SIZE.TARGET_MIN,
    justifyContent: 'center',
    paddingHorizontal: SPACE.LG,
    paddingVertical: SPACE.MD,
    borderWidth: SIZE.BORDER,
    borderRadius: RADIUS.CONTROL,
  },
  primary: { minHeight: SIZE.AUTH_CONTROL },
});

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Fills the row. A button that hugs its label sits on the start edge. */
  stretch?: boolean;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = BUTTON_VARIANT.SECONDARY,
  stretch = false,
  disabled = false,
  busy = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors } = usePaint();
  const { scale, onPressIn, onPressOut } = usePressMotion();
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const { fill, edge, label: tone } = VARIANT[variant];
  const inactive = disabled || busy;

  return (
    <View
      style={[
        styles.ring,
        stretch ? styles.stretch : styles.hug,
        { borderColor: focused ? colors.focus : TRANSPARENT },
      ]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        style={({ pressed }) => ({ opacity: pressed ? OPACITY.PRESSED : OPACITY.FULL })}
      >
        <Animated.View
          style={[
            styles.face,
            variant === BUTTON_VARIANT.PRIMARY && styles.primary,
            {
              backgroundColor: fill ? colors[fill] : TRANSPARENT,
              borderColor: edge ? colors[edge] : TRANSPARENT,
              opacity: inactive ? OPACITY.DISABLED : OPACITY.FULL,
              transform: [{ scale }],
            },
          ]}
        >
          <Label tone={tone} centered>
            {label}
          </Label>
        </Animated.View>
      </Pressable>
    </View>
  );
}
