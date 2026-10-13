import { NativeApp, StartNotice } from '@app/native-ui';
import { FONT_SOURCES, FontsProvider, fontReadiness } from '@app/native-ui/fonts';
import { useFonts } from 'expo-font';
import { deviceLocale, hostProps, logicalInsets, startingNotice } from '@app/native-ui/host';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_NAME } from './config';
import type { StartedShellAuth } from './shell';
import { START, type Start } from './start';
import { NativeProviderButton } from './NativeProviderButton';

const LOCALE = deviceLocale();

function Hosted({ auth }: { auth: StartedShellAuth }) {
  const insets = useSafeAreaInsets();
  return (
    <NativeApp
      {...hostProps(auth, APP_NAME, LOCALE)}
      insets={logicalInsets(insets, LOCALE)}
      providerButton={NativeProviderButton}
    />
  );
}

/** Fills the window while the key answers, so the native window colour never shows through. */
function Starting() {
  const { top } = useSafeAreaInsets();
  return <StartNotice {...startingNotice(LOCALE)} topInset={top} />;
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

  if (start === undefined) return <Starting />;
  // Only a build without the key module linked gets here. It must not run unbound in silence.
  if ('failure' in start) throw start.failure;
  return <Hosted auth={start.auth} />;
}

export default function App() {
  const [loaded, error] = useFonts(FONT_SOURCES);
  return (
    <FontsProvider ready={fontReadiness(loaded, error)}>
      <SafeAreaProvider>
        <Started />
      </SafeAreaProvider>
    </FontsProvider>
  );
}
