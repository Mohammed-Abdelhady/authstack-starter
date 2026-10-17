import { RecordVersion } from '../../common/decorators/record-version.decorator';

export { RecordVersion as StaffVersion } from '../../common/decorators/record-version.decorator';

export class StaffVersionQueryDto {
  @RecordVersion()
  version?: number;
}
