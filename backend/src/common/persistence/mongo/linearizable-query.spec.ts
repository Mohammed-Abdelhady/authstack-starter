import { Mongoose, Schema } from 'mongoose';
import { linearizable } from './linearizable-query';

describe('linearizable query deadline', () => {
  it('bounds each authority read at five seconds', () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    const model = connection.model(
      'LinearizableDeadlineProbe',
      new Schema({ value: String }),
    );
    const query = model.findOne({ value: 'probe' });

    expect(linearizable(query).getOptions().maxTimeMS).toBe(5000);
  });
});
