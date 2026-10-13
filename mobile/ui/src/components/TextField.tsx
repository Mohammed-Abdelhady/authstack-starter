import { useCallback, useState, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { usePaint } from '../context/paint-context';
import { RADIUS, SIZE, SPACE } from '../theme/tokens';
import { Label, Description, editableTextStyle } from './Typography';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  inputRef?: Ref<TextInput>;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  disabled?: boolean;
  secret?: boolean;
  latin?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  keyboardType?: TextInputProps['keyboardType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  maxLength?: number;
  hint?: string;
  testID: string;
}
const styles = StyleSheet.create({
  field: { gap: SPACE.XS },
  input: {
    minHeight: SIZE.TARGET_MIN,
    paddingHorizontal: SPACE.LG,
    paddingVertical: SPACE.MD,
    borderWidth: SIZE.BORDER,
    borderRadius: RADIUS.SURFACE,
  },
});

export function TextField({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  inputRef,
  autoCapitalize = 'none',
  disabled = false,
  secret = false,
  latin = false,
  hint,
  testID,
  autoComplete,
  keyboardType,
  returnKeyType,
  maxLength,
}: TextFieldProps) {
  const { colors, direction } = usePaint();
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
        maxLength={maxLength}
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        editable={!disabled}
        secureTextEntry={secret}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        spellCheck={false}
        onFocus={focus}
        onBlur={blur}
        style={[
          styles.input,
          editableTextStyle(colors),
          {
            backgroundColor: colors.surface,
            borderColor: focused ? colors.focus : colors.border,
            writingDirection: latin ? 'ltr' : direction,
            textAlign: 'auto',
          },
        ]}
      />
      {hint === undefined ? null : <Description>{hint}</Description>}
    </View>
  );
}
