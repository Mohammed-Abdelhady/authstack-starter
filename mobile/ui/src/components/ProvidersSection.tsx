import type { ProviderSignInPort } from '@app/native-auth';
import { EMAIL_SIGN_IN_HINT, type NativeProviderMethod } from '@app/sdk';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { PROVIDERS_TEST_ID } from '../constants/providers';
import { useUi } from '../context/ui-context';
import { useProviders } from '../hooks/use-providers';
import { SIZE, SPACE } from '../theme/tokens';
import { Button } from './Button';
import { Notice, NOTICE_TONE } from './Notice';
import { ProviderRow } from './ProviderRow';
import { SkeletonGroup, SkeletonLine } from './Skeleton';
import { Description, Heading } from './Typography';

const styles = StyleSheet.create({ section: { gap: SPACE.LG } });
interface ProvidersSectionProps {
  providerSignIn?: ProviderSignInPort;
  onSignInAgain?: () => void;
}

function LinkButton({
  method,
  busy,
  link,
}: {
  method: NativeProviderMethod;
  busy: boolean;
  link: (method: NativeProviderMethod) => void;
}) {
  const { t } = useUi();
  const onPress = useCallback(() => link(method), [link, method]);
  return (
    <Button
      testID={`${PROVIDERS_TEST_ID.LINK}-${method.id}`}
      label={t('providers.link', { name: method.displayName })}
      disabled={busy}
      onPress={onPress}
    />
  );
}

export function ProvidersSection({ providerSignIn, onSignInAgain }: ProvidersSectionProps) {
  const { t } = useUi();
  const section = useProviders(providerSignIn);
  const { list, notice } = section;
  return (
    <View testID={PROVIDERS_TEST_ID.SECTION} style={styles.section}>
      <Heading level="section">{t('providers.title')}</Heading>
      <Description>{t('providers.description')}</Description>
      {notice === undefined ? null : (
        <Notice
          testID={PROVIDERS_TEST_ID.NOTICE}
          tone={notice.key === 'providers.updated' ? NOTICE_TONE.INFO : NOTICE_TONE.PROBLEM}
          title={t(notice.key)}
          description={notice.description}
        />
      )}
      {notice?.signInAgain && onSignInAgain ? (
        <Button
          testID={PROVIDERS_TEST_ID.SIGN_IN_AGAIN}
          label={t('providers.signInAgain')}
          onPress={onSignInAgain}
        />
      ) : null}
      {section.loading ? (
        <SkeletonGroup label={t('providers.loading')}>
          <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
        </SkeletonGroup>
      ) : null}
      {list?.providers.length === 0 ? <Description>{t('providers.empty')}</Description> : null}
      {list?.emailSignIn === EMAIL_SIGN_IN_HINT.SWITCHED_OFF ? (
        <Description>{t('providers.emailOff')}</Description>
      ) : null}
      {section.rows.map((row) => (
        <ProviderRow
          key={row.id}
          {...row}
          busy={section.writing}
          onUnlink={section.unlink}
          onSetPrimary={section.setPrimary}
        />
      ))}
      {section.linkable.map((method) => (
        <LinkButton key={method.id} method={method} busy={section.writing} link={section.link} />
      ))}
      <Button
        testID={PROVIDERS_TEST_ID.RETRY}
        label={t('providers.retry')}
        busy={section.loading}
        disabled={section.writing}
        onPress={section.reload}
      />
    </View>
  );
}
