// Enums
export { ErrorCode } from './enums/error-code.enum';

// DTOs
export { ApiResponse, ErrorResponse } from './dto/api-response.dto';
export { UserResponseDto } from './dto/user-response.dto';

// Exceptions
export { AppException } from './exceptions/app.exception';

// Filters
export { GlobalExceptionFilter } from './filters/global-exception.filter';

// Guards
export { PermissionGuard } from './guards/permission.guard';

// Decorators
export {
  RequirePermissions,
  RequireAnyPermission,
  PERMISSIONS_KEY,
  ANY_PERMISSIONS_KEY,
} from './decorators/permissions.decorator';

// Pipes
export { ParseObjectIdPipe } from './pipes/parse-object-id.pipe'; // feature:mongodb

// Services
export { HashService } from './services/hash.service';

// Constants
export * from './constants/permissions';

// Utils
export * from './utils/permission.utils';
export { escapeRegex } from './utils/escape-regex';
export { toBoolean } from './utils/transform';
export {
  isCastError,
  isDuplicateKeyError as isMongoDuplicateKeyError, // feature:mongodb
  isDuplicateEmailError,
} from './utils/driver-error-shape.util';
