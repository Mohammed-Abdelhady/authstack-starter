import { RADIUS, SIZE, type NativeProviderButtonProps } from '@app/native-ui';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import type { GoogleSignInButtonProps } from 'react-native-nitro-google-signin';
import {
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication/build/AppleAuthentication.types';
import type { AppleAuthenticationButtonProps } from 'expo-apple-authentication/build/AppleAuthentication.types';

type GoogleButton = ComponentType<GoogleSignInButtonProps>;
type AppleButton = ComponentType<AppleAuthenticationButtonProps>;

const styles = StyleSheet.create({
  google: { width: '100%', height: SIZE.TARGET_MIN },
  apple: { width: '100%', height: SIZE.TARGET_MIN },
});

function useGoogleButton(enabled: boolean): GoogleButton | undefined {
  const [button, setButton] = useState<GoogleButton>();

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    void import('react-native-nitro-google-signin')
      .then(({ GoogleSignInButton }) => {
        if (mounted) setButton(() => GoogleSignInButton);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [enabled]);

  return enabled ? button : undefined;
}

function useAppleButton(enabled: boolean): AppleButton | undefined {
  const [button, setButton] = useState<AppleButton>();

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    void import('expo-apple-authentication/build/AppleAuthenticationButton')
      .then(({ default: AppleAuthenticationButton }) => {
        if (mounted) setButton(() => AppleAuthenticationButton);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [enabled]);

  return enabled ? button : undefined;
}

export function NativeProviderButton(props: NativeProviderButtonProps) {
  const isGoogle =
    props.method.id === 'google' &&
    props.method.mode === 'googleIdentityToken' &&
    props.method.sdk?.kind === 'google';
  const isApple =
    Platform.OS === 'ios' &&
    props.method.id === 'apple' &&
    props.method.mode === 'appleIdentityTokenAndCode' &&
    props.method.sdk?.kind === 'apple';
  const GoogleButton = useGoogleButton(isGoogle);
  const AppleButton = useAppleButton(isApple);
  const colorScheme = useColorScheme();
  const disabled = props.disabled || props.pending;

  if (isGoogle && GoogleButton) {
    return (
      <GoogleButton
        signInBehavior="none"
        onPress={props.onPress}
        size="standard"
        colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
        disabled={disabled}
        loading={props.pending}
        accessibilityRole="button"
        accessibilityLabel={props.label}
        accessibilityState={{ disabled, busy: props.pending }}
        testID={props.testID}
        style={styles.google}
      />
    );
  }

  if (isApple && AppleButton) {
    return (
      <AppleButton
        onPress={props.onPress}
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={
          colorScheme === 'dark'
            ? AppleAuthenticationButtonStyle.WHITE
            : AppleAuthenticationButtonStyle.BLACK
        }
        cornerRadius={RADIUS.SURFACE}
        pointerEvents={disabled ? 'none' : 'auto'}
        accessibilityRole="button"
        accessibilityLabel={props.label}
        accessibilityLanguage={props.locale}
        accessibilityState={{ disabled, busy: props.pending }}
        testID={props.testID}
        style={styles.apple}
      />
    );
  }

  return null;
}
