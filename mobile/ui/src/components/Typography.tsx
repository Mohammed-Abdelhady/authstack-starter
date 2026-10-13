import type { ComponentRef, ReactNode, Ref } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { usePaint } from '../context/paint-context';
import { TYPE_ROLE, TYPE_ROLE_NAME } from '../theme/tokens';
import { FONT_FAMILY } from '../theme/fonts';
import type { LabelTone, Palette, TypeRoleName } from '../types/theme';

/** The only place a text style is built. Screens pick a role and never a size, weight or colour. */
const ROLE_STYLE = StyleSheet.create({
  screenTitle: metrics(TYPE_ROLE_NAME.SCREEN_TITLE),
  authTitle: metrics(TYPE_ROLE_NAME.AUTH_TITLE),
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

interface TextProps {
  children: ReactNode;
  testID?: string;
  nativeRef?: Ref<ComponentRef<typeof Text>>;
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
  nativeRef,
}: RoleTextProps) {
  const { colors, direction, fontsReady } = usePaint();
  const { fontScale } = useWindowDimensions();
  const fontFamily = fontsReady ? FONT_FAMILY[direction][TYPE_ROLE[role].fontWeight] : undefined;
  return (
    <Text
      // A fresh iOS Text node clears stale live Dynamic Type measurements.
      key={Platform.OS === 'ios' ? fontScale : undefined}
      ref={nativeRef}
      testID={testID}
      accessible={header ? true : undefined}
      accessibilityRole={header ? 'header' : 'text'}
      maxFontSizeMultiplier={TYPE_ROLE[role].maxFontScale}
      style={[
        ROLE_STYLE[role],
        centered ? ROLE_STYLE.center : ROLE_STYLE.start,
        { color: colors[tone ?? TYPE_ROLE[role].color], writingDirection: direction, fontFamily },
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

export function Heading({
  level,
  variant,
  ...props
}: TextProps & { level: keyof typeof HEADING_ROLE; variant?: 'display' }) {
  return (
    <RoleText role={variant ? TYPE_ROLE_NAME.AUTH_TITLE : HEADING_ROLE[level]} header {...props} />
  );
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

export function editableTextStyle(colors: Palette, direction: 'ltr' | 'rtl', fontsReady?: boolean) {
  return {
    ...ROLE_STYLE.body,
    color: colors.text,
    fontFamily: fontsReady ? FONT_FAMILY[direction][TYPE_ROLE.body.fontWeight] : undefined,
  };
}
