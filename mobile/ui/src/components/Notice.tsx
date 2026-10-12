import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { useUi } from '../context/ui-context';
import { SIZE, SPACE, type Palette } from '../theme/tokens';
import { Description, Heading } from './Typography';

export const NOTICE_TONE = { INFO: 'info', PROBLEM: 'problem' } as const;
export type NoticeTone = (typeof NOTICE_TONE)[keyof typeof NOTICE_TONE];

const RULE_COLOR: Record<NoticeTone, keyof Palette> = { info: 'accent', problem: 'danger' };

const styles = StyleSheet.create({
  // The rule sits on the start edge, so it moves to the right when reading right to left.
  notice: { borderStartWidth: SIZE.EDGE_RULE, paddingStart: SPACE.LG, gap: SPACE.XS },
});

interface NoticeProps {
  title: string;
  description?: string;
  tone?: NoticeTone;
  testID?: string;
}

/** A message about what just happened. A screen reader hears it when it appears. */
export function Notice({ title, description, tone = NOTICE_TONE.INFO, testID }: NoticeProps) {
  const { colors } = useUi();
  const announcement = description === undefined ? title : `${title}. ${description}`;
  const lastAnnouncement = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (Platform.OS !== 'ios' || lastAnnouncement.current === announcement) return;
    lastAnnouncement.current = announcement;
    AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={tone === NOTICE_TONE.PROBLEM ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { borderStartColor: colors[RULE_COLOR[tone]] }]}
    >
      <Heading level="section">{title}</Heading>
      {description === undefined ? null : <Description>{description}</Description>}
    </View>
  );
}
