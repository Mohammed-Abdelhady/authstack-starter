import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/services/clock';
import { SecurityEventStore } from '../../session/events/security-event.store';
import { activityQuery } from '../../session/events/utils/activity-query';
import { AdminActivityListData } from './dto/admin-activity-response.dto';
import { toAdminActivityDto } from './mappers/admin-activity.mapper';

@Injectable()
export class AdminActivityService {
  constructor(
    private readonly events: SecurityEventStore,
    private readonly clock: Clock,
  ) {}

  async list(input: unknown): Promise<AdminActivityListData> {
    const query = activityQuery(input);
    const result = await this.events.listActivity(query, this.clock.now());
    return {
      data: result.data.map(toAdminActivityDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }
}
