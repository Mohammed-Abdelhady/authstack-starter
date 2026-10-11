import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useUi } from '../context/ui-context';
import { runMotion } from '../logic/motion';
import { MOTION, OPACITY, SIZE, SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: SIZE.CONTENT_MAX_WIDTH },
});

export const ARRIVAL = { NONE: 'none', FORWARD: 'forward', BACK: 'back' } as const;
export type Arrival = (typeof ARRIVAL)[keyof typeof ARRIVAL];

/** Forward travel comes from the end edge, which is the left when reading right to left. */
const TRAVEL: Record<Arrival, number> = { none: 0, forward: 1, back: -1 };
const RTL_SIGN = -1;
const LTR_SIGN = 1;
const SETTLED = 0;

interface ScreenProps {
  children: ReactNode;
  arrival?: Arrival;
  testID?: string;
}

/** Page padding inside the system's safe area, and the short slide a screen arrives with. */
export function Screen({ children, arrival = ARRIVAL.NONE, testID }: ScreenProps) {
  const { insets, direction, reduceMotion } = useUi();
  const animated = !reduceMotion && arrival !== ARRIVAL.NONE;
  const progress = useRef(new Animated.Value(animated ? OPACITY.HIDDEN : OPACITY.FULL)).current;

  useEffect(() => {
    return runMotion(
      animated,
      () => progress.setValue(OPACITY.FULL),
      () =>
        Animated.timing(progress, {
          toValue: OPACITY.FULL,
          duration: MOTION.SCREEN_MS,
          useNativeDriver: true,
        }),
    );
  }, [animated, progress]);

  const from = TRAVEL[arrival] * (direction === 'rtl' ? RTL_SIGN : LTR_SIGN) * MOTION.SCREEN_SHIFT;
  const translateX = progress.interpolate({
    inputRange: [OPACITY.HIDDEN, OPACITY.FULL],
    outputRange: [from, SETTLED],
  });

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.screen,
        {
          direction,
          paddingTop: insets.top + SPACE.XL,
          paddingBottom: insets.bottom + SPACE.XL,
          paddingStart: insets.start + SPACE.XL,
          paddingEnd: insets.end + SPACE.XL,
          opacity: progress,
          transform: [{ translateX }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
