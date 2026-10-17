import type { PasskeySummary } from '@app/sdk';
import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BUTTON_VARIANT } from '../constants/button';
import {
  PASSKEY_NAME_MAX_LENGTH,
  PASSKEYS_TEST_ID,
  PASSKEY_REQUIRED_LAST_CODE,
} from '../constants/passkeys';
import { useUi } from '../context/ui-context';
import { passkeyDates, passkeyName } from '../logic/passkey-text';
import { SPACE } from '../theme/tokens';
import { Button } from './Button';
import { Surface } from './Surface';
import { TextField } from './TextField';
import { Body, Description } from './Typography';

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.SM },
  details: { gap: SPACE.XS },
});

interface PasskeyRowProps {
  passkey: PasskeySummary;
  busy: boolean;
  onRename: (passkey: PasskeySummary, name: string) => Promise<boolean>;
  onRemove: (passkey: PasskeySummary) => void;
}

/** One passkey: its name and dates, and the rename and remove actions. */
export const PasskeyRow = memo(function PasskeyRow({
  passkey,
  busy,
  onRename,
  onRemove,
}: PasskeyRowProps) {
  const { t, locale } = useUi();
  const [draft, setDraft] = useState<string>();
  const name = passkeyName(t, passkey);
  const blank = draft === undefined || draft.trim().length === 0;

  const startRename = useCallback(() => setDraft(passkey.name), [passkey.name]);
  const cancelRename = useCallback(() => setDraft(undefined), []);
  const save = useCallback(() => {
    if (draft === undefined || draft.trim().length === 0) return;
    void onRename(passkey, draft).then((saved) => {
      if (saved) setDraft(undefined);
    });
  }, [draft, onRename, passkey]);
  const remove = useCallback(() => onRemove(passkey), [onRemove, passkey]);

  return (
    <Surface compact testID={`${PASSKEYS_TEST_ID.ROW}-${passkey.id}`}>
      <View style={styles.details}>
        <Body>{name}</Body>
        {passkeyDates(t, locale, passkey).map((line) => (
          <Description key={line}>{line}</Description>
        ))}
      </View>
      {passkey.canRemove === false ? (
        <Description>
          {t(
            passkey.removalBlockedCode === PASSKEY_REQUIRED_LAST_CODE
              ? 'passkeys.removeFailed.required'
              : 'passkeys.removeFailed.lastWayIn',
          )}
        </Description>
      ) : null}
      {draft === undefined ? (
        <View style={styles.actions}>
          <Button
            testID={PASSKEYS_TEST_ID.RENAME}
            label={t('passkeys.rename')}
            accessibilityLabel={t('passkeys.renameLabel', { name })}
            disabled={busy}
            onPress={startRename}
          />
          <Button
            testID={PASSKEYS_TEST_ID.REMOVE}
            variant={BUTTON_VARIANT.DANGER}
            label={t('passkeys.remove')}
            accessibilityLabel={t('passkeys.removeLabel', { name })}
            busy={busy}
            disabled={passkey.canRemove === false}
            onPress={remove}
          />
        </View>
      ) : (
        <>
          <TextField
            testID={PASSKEYS_TEST_ID.NAME_FIELD}
            label={t('passkeys.nameField')}
            hint={t('passkeys.nameHint')}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={save}
            autoCapitalize="sentences"
            maxLength={PASSKEY_NAME_MAX_LENGTH}
            returnKeyType="done"
            disabled={busy}
          />
          <View style={styles.actions}>
            <Button
              testID={PASSKEYS_TEST_ID.SAVE_NAME}
              variant={BUTTON_VARIANT.PRIMARY}
              label={t('passkeys.saveName')}
              disabled={blank}
              busy={busy}
              onPress={save}
            />
            <Button
              testID={PASSKEYS_TEST_ID.CANCEL_RENAME}
              label={t('common.cancel')}
              disabled={busy}
              onPress={cancelRename}
            />
          </View>
        </>
      )}
    </Surface>
  );
});
