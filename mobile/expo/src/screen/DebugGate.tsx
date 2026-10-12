import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: { position: 'absolute', top: 0, start: 0, end: 0 },
});

interface DebugGateProps {
  available: boolean;
  holdMs: number;
  /** Height of the band at the top of the screen, the only part that listens. */
  stripHeight: number;
  onOpen: () => void;
  children: ReactNode;
}

/** Where the gate is closed, the app is rendered with nothing around it. */
export function DebugGate({ available, holdMs, stripHeight, onOpen, children }: DebugGateProps) {
  if (!available) return children;
  return (
    <View style={styles.fill}>
      {children}
      {/* Beside the screens, never around them: a wrapper that takes touches stops lists scrolling. */}
      <Pressable
        accessible={false}
        style={[styles.strip, { height: stripHeight }]}
        delayLongPress={holdMs}
        onLongPress={onOpen}
      />
    </View>
  );
}
