import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { Screen, type Arrival } from '../components/Screen';
import { SessionCard } from '../components/SessionCard';
import { SkeletonGroup, SkeletonLine } from '../components/Skeleton';
import { Description, Heading } from '../components/Typography';
import { LIST_VIEW, TEST_ID } from '../constants';
import { useUi } from '../context/ui-context';
import { useSessions } from '../hooks/use-sessions';
import { SIZE, SPACE } from '../theme/tokens';
import type { SessionRow } from '../types';

const styles = StyleSheet.create({
  list: { gap: SPACE.XL, flexGrow: 1 },
  group: { gap: SPACE.LG },
  intro: { gap: SPACE.SM },
  head: { gap: SPACE.XXL },
});

const keyOf = (row: SessionRow): string => row.id;

interface SessionsScreenProps {
  arrival: Arrival;
  onBack: () => void;
}

function SessionsSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
      <SkeletonLine width={SIZE.SKELETON_SHORT} height={SIZE.SKELETON_LINE} />
      <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
      <SkeletonLine width={SIZE.SKELETON_SHORT} height={SIZE.SKELETON_LINE} />
      <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
    </SkeletonGroup>
  );
}

export function SessionsScreen({ arrival, onBack }: SessionsScreenProps) {
  const { t, colors } = useUi();
  const sessions = useSessions();
  const { view, current, others, problem, refreshing, refresh, revoke, revokeOthers } = sessions;
  const { writingRow, writingOthers } = sessions;

  const renderRow = useCallback(
    ({ item }: { item: SessionRow }) => (
      <SessionCard row={item} onRevoke={revoke} busy={item.id === writingRow} />
    ),
    [revoke, writingRow],
  );

  const head = (
    <View style={styles.head}>
      <Button testID={TEST_ID.SESSIONS_BACK} label={t('sessions.back')} onPress={onBack} />
      <View style={styles.intro}>
        <Heading level="screen">{t('sessions.title')}</Heading>
        <Description>{t('sessions.description')}</Description>
      </View>
      {problem === undefined ? null : (
        <Notice
          testID={TEST_ID.SESSIONS_NOTICE}
          tone={NOTICE_TONE.PROBLEM}
          title={problem.title}
          description={problem.description}
        />
      )}
      {view === LIST_VIEW.LOADING ? <SessionsSkeleton label={t('sessions.loading')} /> : null}
      {view === LIST_VIEW.ERROR ? (
        <View style={styles.group}>
          <Notice
            tone={NOTICE_TONE.PROBLEM}
            title={t('sessions.error.title')}
            description={sessions.failureText}
          />
          <Button testID={TEST_ID.SESSIONS_RETRY} label={t('common.tryAgain')} onPress={refresh} />
        </View>
      ) : null}
      {current === undefined ? null : (
        <View style={styles.group}>
          <Heading level="section">{t('sessions.thisDevice')}</Heading>
          <SessionCard row={current} onRevoke={revoke} busy={current.id === writingRow} />
        </View>
      )}
      {view === LIST_VIEW.EMPTY ? (
        <Notice title={t('sessions.empty.title')} description={t('sessions.empty.description')} />
      ) : null}
      {view === LIST_VIEW.READY ? (
        <Heading level="section">{t('sessions.otherDevices')}</Heading>
      ) : null}
    </View>
  );

  const foot =
    view === LIST_VIEW.READY ? (
      <Button
        testID={TEST_ID.SESSIONS_REVOKE_OTHERS}
        stretch
        label={t('sessions.revokeOthers')}
        busy={writingOthers}
        onPress={revokeOthers}
      />
    ) : null;

  return (
    <Screen testID={TEST_ID.SESSIONS_SCREEN} arrival={arrival}>
      <FlatList
        testID={TEST_ID.SESSIONS_LIST}
        data={others}
        keyExtractor={keyOf}
        renderItem={renderRow}
        extraData={writingRow}
        ListHeaderComponent={head}
        ListFooterComponent={foot}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            title={t('sessions.refresh')}
            titleColor={colors.textMuted}
            accessibilityLabel={t('sessions.refresh')}
          />
        }
      />
    </Screen>
  );
}
