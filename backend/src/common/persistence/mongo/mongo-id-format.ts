import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { IdFormat } from '../id-format';

/** An id is text the driver's own parser reads as an ObjectId. */
@Injectable()
export class MongoIdFormat extends IdFormat {
  isId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }
}
