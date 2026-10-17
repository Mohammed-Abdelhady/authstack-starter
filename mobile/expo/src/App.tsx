import { NativeApp } from '@app/native-ui';
import { FONT_SOURCES, FontsProvider, fontReadiness } from '@app/native-ui/fonts';
import { useFonts } from 'expo-font';
import { deviceLocale, hostProps, logicalInsets } from '@app/native-ui/host';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_NAME, DEBUG_BAND_HEIGHT, DEBUG_HOLD_MS, DEBUG_VIEW_AVAILABLE } from './config';
import { DIRECTION, translate } from './i18n/messages';
import { render } from './logic/outcome-text';
import { DebugGate } from './screen/DebugGate';
import { DebugScreen } from './screen/DebugScreen';
import { StartNotice } from './screen/StartNotice';
import type { StartedShellAuth } from './shell';
import { START, type Start } from './start';
import { NativeProviderButton } from './NativeProviderButton'; // feature:google,apple

const LOCALE = deviceLocale();
const PROVIDER_BUTTON_PROPS = {
  providerButton: NativeProviderButton, // feature:google,apple
};

function Hosted({ auth }: { auth: StartedShellAuth }) {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const openCheck = useCallback(() => setChecking(true), []);
  const closeCheck = useCallback(() => setChecking(false), []);

  if (checking) return <DebugScreen auth={auth} locale={LOCALE} onClose={closeCheck} />;
  return (
    <DebugGate
      available={DEBUG_VIEW_AVAILABLE}
      holdMs={DEBUG_HOLD_MS}
      stripHeight={insets.top + DEBUG_BAND_HEIGHT}
      onOpen={openCheck}
    >
      <NativeApp
        {...hostProps(auth, APP_NAME, LOCALE)}
        insets={logicalInsets(insets, LOCALE)}
        {...PROVIDER_BUTTON_PROPS}
        accountDeletion={auth.accountDeletion}
        emailConfirmation={auth.emailConfirmation}
        providerSignIn={auth.providerSignIn}
      />
    </DebugGate>
  );
}

function Started() {
  const [start, setStart] = useState<Start>();

  useEffect(() => {
    let mounted = true;
    void START.then((started) => {
      if (mounted) setStart(started);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (start === undefined)
    return <StartNotice direction={DIRECTION[LOCALE]} text={translate(LOCALE, 'starting')} />;
  if ('failure' in start) {
    return (
      <StartNotice
        direction={DIRECTION[LOCALE]}
        text={translate(LOCALE, 'startFailed', render(LOCALE, start.failure))}
        alert
      />
    );
  }
  return <Hosted auth={start.auth} />;
}

export function App() {
  const [loaded, error] = useFonts(FONT_SOURCES);
  return (
    <FontsProvider ready={fontReadiness(loaded, error)}>
      <SafeAreaProvider>
        <Started />
      </SafeAreaProvider>
    </FontsProvider>
  );
}
