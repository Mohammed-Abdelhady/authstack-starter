import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { usePaint } from '../context/paint-context';
import { TYPE_ROLE, TYPE_ROLE_NAME, type Palette, type TypeRoleName } from '../theme/tokens';

/** The only place a text style is built. Screens pick a role and never a size, weight or colour. */
const ROLE_STYLE = StyleSheet.create({
  screenTitle: metrics(TYPE_ROLE_NAME.SCREEN_TITLE),
  sectionHeading: metrics(TYPE_ROLE_NAME.SECTION_HEADING),
  description: metrics(TYPE_ROLE_NAME.DESCRIPTION),
  body: metrics(TYPE_ROLE_NAME.BODY),
  label: metrics(TYPE_ROLE_NAME.LABEL),
  // Text sits on the start edge of its column in both directions, whatever script it holds.
  start: { alignSelf: 'flex-start', textAlign: 'auto' },
  center: { alignSelf: 'center', textAlign: 'center' },
});

function metrics(role: TypeRoleName) {
  const { fontSize, lineHeight, fontWeight } = TYPE_ROLE[role];
  return { fontSize, lineHeight, fontWeight };
}

export type LabelTone = Extract<keyof Palette, 'text' | 'danger' | 'onAccent'>;

interface TextProps {
  children: ReactNode;
  testID?: string;
}

interface RoleTextProps extends TextProps {
  role: TypeRoleName;
  tone?: LabelTone;
  centered?: boolean;
  header?: boolean;
}

function RoleText({
  role,
  tone,
  centered = false,
  header = false,
  children,
  testID,
}: RoleTextProps) {
  const { colors, direction } = usePaint();
  return (
    <Text
      testID={testID}
      accessibilityRole={header ? 'header' : 'text'}
      maxFontSizeMultiplier={TYPE_ROLE[role].maxFontScale}
      style={[
        ROLE_STYLE[role],
        centered ? ROLE_STYLE.center : ROLE_STYLE.start,
        { color: colors[tone ?? TYPE_ROLE[role].color], writingDirection: direction },
      ]}
    >
      {children}
    </Text>
  );
}

const HEADING_ROLE = {
  screen: TYPE_ROLE_NAME.SCREEN_TITLE,
  section: TYPE_ROLE_NAME.SECTION_HEADING,
} as const;

export function Heading({ level, ...props }: TextProps & { level: keyof typeof HEADING_ROLE }) {
  return <RoleText role={HEADING_ROLE[level]} header {...props} />;
}

export function Description(props: TextProps) {
  return <RoleText role={TYPE_ROLE_NAME.DESCRIPTION} {...props} />;
}

export function Body(props: TextProps) {
  return <RoleText role={TYPE_ROLE_NAME.BODY} {...props} />;
}

export function Label(props: TextProps & { tone?: LabelTone; centered?: boolean }) {
  return <RoleText role={TYPE_ROLE_NAME.LABEL} {...props} />;
}
