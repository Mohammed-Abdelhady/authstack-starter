import { StartNotice as SharedStartNotice } from '@app/native-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Direction } from '../i18n/messages';

interface StartNoticeProps {
  text: string;
  direction: Direction;
  alert?: boolean;
}

/** The shared notice, under the safe area this shell measures. */
export function StartNotice({ text, direction, alert = false }: StartNoticeProps) {
  const { top } = useSafeAreaInsets();
  return <SharedStartNotice text={text} direction={direction} alert={alert} topInset={top} />;
}
