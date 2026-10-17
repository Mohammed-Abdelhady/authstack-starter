import { RecordVersion } from '../../common/decorators/record-version.decorator';

export class ResendEmailChangeDto {
  @RecordVersion()
  version?: number;
}
