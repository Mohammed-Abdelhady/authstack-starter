import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { SecurityEvent } from '../../src/session/persistence/mongo/schemas/security-event.schema';

const UNREADABLE_EVENTS = 'activity_reader_failure';

export async function makeActivityUnreadable(
  app: INestApplication,
): Promise<() => Promise<void>> {
  const connection = app.get<Connection>(getConnectionToken());
  const model = app.get<Model<SecurityEvent>>(
    getModelToken(SecurityEvent.name),
  );
  const database = connection.db;
  if (!database) throw new Error('Activity fixture has no database');
  const name = model.collection.collectionName;
  await database.collection(name).rename(UNREADABLE_EVENTS);
  try {
    await database.createCollection(name, {
      viewOn: UNREADABLE_EVENTS,
      pipeline: [{ $addFields: { activityFailure: { $divide: [1, 0] } } }],
    });
  } catch (error) {
    await database.collection(UNREADABLE_EVENTS).rename(name);
    throw error;
  }
  return async () => {
    await database.dropCollection(name);
    await database.collection(UNREADABLE_EVENTS).rename(name);
  };
}
