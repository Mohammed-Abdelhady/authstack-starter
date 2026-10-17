import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { PROVIDERS_TEST_ID } from '../constants/providers';
import { useUi } from '../context/ui-context';
import { SPACE } from '../theme/tokens';
import { Button, BUTTON_VARIANT } from './Button';
import { Surface } from './Surface';
import { Body, Description } from './Typography';

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.SM },
});
interface ProviderRowProps {
  id: string;
  name: string;
  primary: boolean;
  canUnlink: boolean;
  canSetPrimary: boolean;
  busy: boolean;
  onUnlink: (id: string) => void;
  onSetPrimary: (id: string) => void;
}

export const ProviderRow = memo(function ProviderRow({
  id,
  name,
  primary,
  canUnlink,
  canSetPrimary,
  busy,
  onUnlink,
  onSetPrimary,
}: ProviderRowProps) {
  const { t } = useUi();
  const unlink = useCallback(() => onUnlink(id), [id, onUnlink]);
  const setPrimary = useCallback(() => onSetPrimary(id), [id, onSetPrimary]);
  return (
    <Surface compact testID={`${PROVIDERS_TEST_ID.ROW}-${id}`}>
      <Body>{name}</Body>
      {primary ? <Description>{t('providers.primary')}</Description> : null}
      <View style={styles.actions}>
        {canUnlink ? (
          <Button
            testID={`${PROVIDERS_TEST_ID.UNLINK}-${id}`}
            label={t('providers.unlink')}
            accessibilityLabel={t('providers.unlinkLabel', { name })}
            variant={BUTTON_VARIANT.DANGER}
            disabled={busy}
            onPress={unlink}
          />
        ) : null}
        {canSetPrimary ? (
          <Button
            testID={`${PROVIDERS_TEST_ID.PRIMARY}-${id}`}
            label={t('providers.setPrimary')}
            accessibilityLabel={t('providers.primaryLabel', { name })}
            disabled={busy}
            onPress={setPrimary}
          />
        ) : null}
      </View>
    </Surface>
  );
});
