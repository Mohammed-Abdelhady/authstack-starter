import { ClientSession, Connection } from 'mongoose';
import { partialMock } from '../../testing/test-doubles.harness-spec';

/**
 * A driver session double for the existing service unit fixtures.
 */
function createClientSessionMock(): ClientSession {
  return partialMock<ClientSession>({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
    inTransaction: jest.fn().mockReturnValue(true),
  });
}

/**
 * A connection double that hands out the unit fixture's driver session.
 */
export function createConnectionMock(): Connection {
  return partialMock<Connection>({
    startSession: jest.fn().mockResolvedValue(createClientSessionMock()),
  });
}
