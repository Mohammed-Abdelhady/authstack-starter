import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Text } from 'react-native';

/** Focus the new screen's title after its native text node mounts. */
export function useScreenTitleFocus() {
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    const titleTag = findNodeHandle(titleRef.current);
    if (titleTag !== null) AccessibilityInfo.setAccessibilityFocus(titleTag);
  }, []);

  return titleRef;
}
