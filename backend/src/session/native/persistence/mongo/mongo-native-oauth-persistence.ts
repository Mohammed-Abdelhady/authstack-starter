import { Provider } from '@nestjs/common';
import { NativeAuthorizationStore } from '../../authorize/native-authorization.store';
import { NativeRotationStore } from '../../credentials/native-rotation.store';
import { MongoNativeAuthorizationStore } from './mongo-native-authorization.store';
import { MongoNativeRotationStore } from './mongo-native-rotation.store';

export const MONGO_NATIVE_OAUTH_PROVIDERS: Provider[] = [
  {
    provide: NativeAuthorizationStore,
    useClass: MongoNativeAuthorizationStore,
  },
  { provide: NativeRotationStore, useClass: MongoNativeRotationStore },
];
