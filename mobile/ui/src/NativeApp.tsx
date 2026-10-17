import { useCallback, useEffect, useMemo } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { Provider } from 'react-redux';
import { confirmWithAlert } from './components/confirm';
import { ROOT_VIEW, ROUTE, SIGN_IN_ACTION } from './constants';
import { PaintContext } from './context/paint-context';
import { UiContext, type Ui } from './context/ui-context';
import { useEngineSnapshot } from './hooks/use-engine-snapshot';
import { useForegroundRestore } from './hooks/use-foreground-restore';
import { useReducedMotion } from './hooks/use-reduced-motion';
import { useRoute } from './hooks/use-route';
import { useTheme } from './hooks/use-theme';
import { useWebFonts } from './hooks/use-web-fonts';
import { createTranslate, DIRECTION } from './i18n';
import { rootView } from './logic/sign-in-view';
import { AccountScreen } from './screens/AccountScreen';
import { SessionsScreen } from './screens/SessionsScreen';
import { SignInScreen } from './screens/SignInScreen';
import { createUiRuntime } from './state/runtime';
import type { NativeAppProps } from './types';

const styles = StyleSheet.create({ root: { flex: 1 } });

const systemClock = (): number => Date.now();

function SignedInScreens({
  engine,
  accountDeletion,
  providerSignIn,
}: Pick<NativeAppProps, 'engine' | 'accountDeletion' | 'providerSignIn'>) {
  const signInAgain = useCallback(() => {
    void engine.signOut();
  }, [engine]);
  const { route, arrival, openSessions, goBack } = useRoute();
  return route === ROUTE.SESSIONS ? (
    <SessionsScreen arrival={arrival} onBack={goBack} />
  ) : (
    <AccountScreen
      arrival={arrival}
      onOpenSessions={openSessions}
      passkeys={engine.passkeys} // feature:passkeys
      accountDeletion={accountDeletion}
      providerSignIn={providerSignIn} // feature:oauth-core
      onSignInAgain={signInAgain}
    />
  );
}

/**
 * The whole signed-out and signed-in experience for one engine. The shell hands
 * in the engine and everything that differs between platforms.
 */
export function NativeApp({
  engine,
  providerButton,
  providerSignIn,
  accountDeletion,
  emailConfirmation,
  appName,
  locale,
  insets,
  now = systemClock,
  confirm = confirmWithAlert,
}: NativeAppProps) {
  const runtime = useMemo(() => createUiRuntime(engine), [engine]);
  useEffect(() => runtime.start(), [runtime]);
  const restore = useCallback(() => runtime.signIn.run(SIGN_IN_ACTION.RESTORE), [runtime]);
  useForegroundRestore(restore);

  const snapshot = useEngineSnapshot(engine);
  const reduceMotion = useReducedMotion();
  const fontsReady = useWebFonts();
  const { colors, statusBarStyle } = useTheme();
  const direction = DIRECTION[locale];

  const ui = useMemo<Ui>(
    () => ({
      colors,
      direction,
      locale,
      t: createTranslate(locale),
      reduceMotion,
      fontsReady,
      insets,
      runtime,
      now,
      confirm,
      appName,
      providerButton,
    }),
    [
      appName,
      colors,
      confirm,
      direction,
      fontsReady,
      insets,
      locale,
      now,
      providerButton,
      reduceMotion,
      runtime,
    ],
  );

  return (
    <Provider store={runtime.store}>
      <UiContext.Provider value={ui}>
        <PaintContext.Provider value={ui}>
          <View style={[styles.root, { backgroundColor: colors.background, direction }]}>
            <StatusBar barStyle={statusBarStyle} />
            {rootView(snapshot) === ROOT_VIEW.SIGNED_IN ? (
              <SignedInScreens
                engine={engine}
                accountDeletion={accountDeletion}
                providerSignIn={providerSignIn}
              />
            ) : (
              <SignInScreen
                accountDeletion={accountDeletion}
                emailConfirmation={emailConfirmation}
              />
            )}
          </View>
        </PaintContext.Provider>
      </UiContext.Provider>
    </Provider>
  );
}
