import type { NativeProviderButtonProps } from '@app/native-ui';
import { RADIUS } from '@app/native-ui'; // feature:apple
import { SIZE } from '@app/native-ui'; // feature:google,apple
import type { ComponentType } from 'react'; // feature:google,apple
import { useEffect, useState } from 'react'; // feature:google,apple
import { Platform } from 'react-native'; // feature:apple
import { StyleSheet, useColorScheme } from 'react-native'; // feature:google,apple
import type { GoogleSignInButtonProps } from 'react-native-nitro-google-signin'; // feature:google
// feature:apple:start
import {
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication/build/AppleAuthentication.types';
import type { AppleAuthenticationButtonProps } from 'expo-apple-authentication/build/AppleAuthentication.types';
// feature:apple:end

// feature:google:start
type GoogleButton = ComponentType<GoogleSignInButtonProps>;
// feature:google:end
// feature:apple:start
type AppleButton = ComponentType<AppleAuthenticationButtonProps>;
// feature:apple:end

// feature:google,apple:start
const styles = StyleSheet.create({
  // feature:google:start
  google: { width: '100%', height: SIZE.TARGET_MIN },
  // feature:google:end
  // feature:apple:start
  apple: { width: '100%', height: SIZE.TARGET_MIN },
  // feature:apple:end
});
// feature:google,apple:end

// feature:google:start
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
// feature:google:end

// feature:apple:start
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
// feature:apple:end

export function NativeProviderButton(props: NativeProviderButtonProps) {
  // feature:google:start
  const isGoogle =
    props.method.id === 'google' &&
    props.method.mode === 'googleIdentityToken' &&
    props.method.sdk?.kind === 'google';
  // feature:google:end
  // feature:apple:start
  const isApple =
    Platform.OS === 'ios' &&
    props.method.id === 'apple' &&
    props.method.mode === 'appleIdentityTokenAndCode' &&
    props.method.sdk?.kind === 'apple';
  // feature:apple:end
  // feature:google:start
  const GoogleButton = useGoogleButton(isGoogle);
  // feature:google:end
  // feature:apple:start
  const AppleButton = useAppleButton(isApple);
  // feature:apple:end
  // feature:google,apple:start
  const colorScheme = useColorScheme();
  const disabled = props.disabled || props.pending;
  // feature:google,apple:end

  // feature:google:start
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
  // feature:google:end

  // feature:apple:start
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
  // feature:apple:end

  return null;
}
