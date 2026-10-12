import { Provider } from '@nestjs/common';
import { onDatabase } from '../../../../common/persistence/postgres/postgres-providers';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import {
  MagicLinkAccounts,
  MagicLinkSignIn,
} from '../../stores/magic-link-accounts';
import { MagicLinkStore } from '../../stores/magic-link.store';
import {
  PostgresMagicLinkAccounts,
  PostgresMagicLinkSignIn,
  PostgresMagicLinkStore,
} from './postgres-magic-link.store';

export const POSTGRES_MAGIC_LINK_PROVIDERS: Provider[] = [
  onDatabase(
    MagicLinkStore,
    (database) => new PostgresMagicLinkStore(database),
  ),
  onDatabase(
    MagicLinkAccounts,
    (database) => new PostgresMagicLinkAccounts(database),
  ),
  {
    provide: MagicLinkSignIn,
    useFactory: (completion: SignInCompletion) =>
      new PostgresMagicLinkSignIn(completion),
    inject: [SignInCompletion],
  },
];
