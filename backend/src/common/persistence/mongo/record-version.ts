import { Query, Schema } from 'mongoose';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writesTracked(
  update: Record<string, unknown>,
  tracked: (path: string) => boolean,
): boolean {
  return Object.entries(update).some(([operator, value]) => {
    if (!operator.startsWith('$')) return tracked(operator);
    if (!record(value)) return false;
    return Object.entries(value).some(
      ([path, destination]) =>
        tracked(path) ||
        (operator === '$rename' &&
          typeof destination === 'string' &&
          tracked(destination)),
    );
  });
}

/**
 * Raises `version` on every update or save that writes one of the tracked
 * fields, through any operator, a top-level field or a pipeline stage.
 */
export function registerRecordVersion<Doc>(
  schema: Schema<Doc>,
  trackedFields: readonly string[],
): void {
  const fields = new Set(trackedFields);
  const tracked = (path: string): boolean => fields.has(path.split('.')[0]);
  schema.pre<Query<unknown, Doc>>(
    ['updateOne', 'updateMany', 'findOneAndUpdate'],
    function () {
      const update: unknown = this.getUpdate();
      if (Array.isArray(update)) {
        const stages: unknown[] = update;
        const changesTracked = stages.some(
          (stage) =>
            record(stage) &&
            ['$set', '$addFields'].some((operator) => {
              const assigned = stage[operator];
              return record(assigned) && Object.keys(assigned).some(tracked);
            }),
        );
        if (changesTracked) {
          this.setUpdate([
            ...update,
            { $set: { version: { $add: [{ $ifNull: ['$version', 0] }, 1] } } },
          ]);
        }
        return;
      }
      if (!record(update) || !writesTracked(update, tracked)) return;
      const increments = record(update.$inc) ? update.$inc : {};
      this.setUpdate({ ...update, $inc: { ...increments, version: 1 } });
    },
  );
  schema.pre('save', function () {
    if (!this.isNew && trackedFields.some((path) => this.isModified(path))) {
      this.$inc('version', 1);
    }
  });
}
