import type { CallOptions } from '../client';
import type { TransportRequest, TransportResponse, TransportSignal } from '../transport';

export type AreaCall<TSignal extends TransportSignal> = Omit<TransportRequest<TSignal>, 'signal'>;
export type AreaOptions<TSignal extends TransportSignal> = CallOptions<TSignal> | undefined;

/** The guarded senders `createApiClient` hands to each area builder. */
export interface AreaSenders<TSignal extends TransportSignal> {
  send(call: AreaCall<TSignal>, options: AreaOptions<TSignal>): Promise<TransportResponse>;
  sendObject<T extends object>(call: AreaCall<TSignal>, options: AreaOptions<TSignal>): Promise<T>;
}
