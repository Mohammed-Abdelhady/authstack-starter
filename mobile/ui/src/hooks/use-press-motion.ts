import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { usePaint } from '../context/paint-context';
import { runMotion } from '../logic/motion';
import { MOTION } from '../theme/tokens';

const REST_SCALE = 1;

/** A control that gives a little under the finger. With reduced motion it stays still. */
export function usePressMotion() {
  const { reduceMotion } = usePaint();
  const scale = useRef(new Animated.Value(REST_SCALE)).current;

  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (reduceMotion) {
      stop.current?.();
      scale.setValue(REST_SCALE);
    }
    return () => stop.current?.();
  }, [reduceMotion, scale]);

  const move = useCallback(
    (toValue: number) => {
      stop.current?.();
      stop.current = runMotion(
        !reduceMotion,
        () => scale.setValue(REST_SCALE),
        () =>
          Animated.timing(scale, {
            toValue,
            duration: MOTION.PRESS_MS,
            useNativeDriver: true,
          }),
      );
    },
    [reduceMotion, scale],
  );

  return {
    scale,
    onPressIn: useCallback(() => move(MOTION.PRESS_SCALE), [move]),
    onPressOut: useCallback(() => move(REST_SCALE), [move]),
  };
}
