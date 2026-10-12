import { Provider } from '@nestjs/common';
import { onDatabase } from '../../../../common/persistence/postgres/postgres-providers';
import { NativeAuthorizationStore } from '../../authorize/native-authorization.store';
import { NativeRotationStore } from '../../credentials/native-rotation.store';
import { PostgresNativeAuthorizationStore } from './postgres-native-authorization.store';
import { PostgresNativeRotationStore } from './postgres-native-rotation.store';

export const POSTGRES_NATIVE_OAUTH_PROVIDERS: Provider[] = [
  onDatabase(
    NativeAuthorizationStore,
    (database) => new PostgresNativeAuthorizationStore(database),
  ),
  { provide: NativeRotationStore, useClass: PostgresNativeRotationStore },
];
