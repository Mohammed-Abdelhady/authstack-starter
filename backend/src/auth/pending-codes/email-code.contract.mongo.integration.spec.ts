import { bootMongoEmailCodeHarness } from '../persistence/mongo/mongo-email-code.harness-spec';
import { describeEmailCodeContract } from './email-code.harness-spec';

describeEmailCodeContract('MongoDB', bootMongoEmailCodeHarness);
