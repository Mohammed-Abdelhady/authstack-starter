/**
 * Test-only rendezvous for forcing a specific interleaving.
 *
 * `RaceGate.hold()` blocks every caller that reaches the gate until `release()`
 * is called; `reached(n)` resolves once `n` callers are held. There are no
 * timers, sleeps or retries, so a test that names an interleaving gets exactly
 * that interleaving on every run.
 *
 * `RaceBarrier` groups gates by a name so a spec can keep its named pause points
 * apart. Neither class imports or reaches into Mongoose; the pause is placed at
 * a seam the spec holds (a spied collaborator or a paused model query).
 *
 * Prefer `holdBefore` on a public service method: that seam outlives a change
 * of database, a paused model query does not.
 */
export class RaceGate {
  private held = 0;
  private open = false;
  private readonly waiting: Array<() => void> = [];
  private arrivals: Array<{ count: number; resolve: () => void }> = [];

  async hold(): Promise<void> {
    if (this.open) {
      return;
    }
    this.held += 1;
    this.settleArrivals();
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  reached(count = 1): Promise<void> {
    if (this.held >= count) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.arrivals.push({ count, resolve });
    });
  }

  release(): void {
    this.open = true;
    for (const resolve of this.waiting.splice(0)) {
      resolve();
    }
  }

  private settleArrivals(): void {
    const remaining: typeof this.arrivals = [];
    for (const arrival of this.arrivals) {
      if (this.held >= arrival.count) {
        arrival.resolve();
      } else {
        remaining.push(arrival);
      }
    }
    this.arrivals = remaining;
  }
}

export class RaceBarrier {
  private readonly gates = new Map<string, RaceGate>();

  point(name: string): RaceGate {
    const existing = this.gates.get(name);
    if (existing) {
      return existing;
    }
    const gate = new RaceGate();
    this.gates.set(name, gate);
    return gate;
  }

  release(name: string): void {
    this.point(name).release();
  }
}

/**
 * Pauses a model query at its public `exec()` call: the spec spies a model
 * method (for example `updateOne`) and hands the returned query here. The write
 * does not reach the database until the gate opens, which is what forces two
 * racers to attempt the same guarded write from the same pre-spend state.
 */
export function pauseQuery<Result>(
  query: { exec: () => Promise<Result> },
  gate: RaceGate,
): void {
  const execute = query.exec.bind(query);
  jest.spyOn(query, 'exec').mockImplementation(async () => {
    await gate.hold();
    return execute();
  });
}

type AsyncMethod = (...args: never[]) => Promise<unknown>;

export type AsyncMethodName<Service> = {
  [Key in keyof Service]: Service[Key] extends AsyncMethod ? Key : never;
}[keyof Service] &
  string;

/**
 * Holds chosen calls to a public service method on a gate before the real
 * method runs, and returns the function that puts the method back. `call`
 * counts from zero across every caller and `args` are that call's arguments.
 */
export function holdBefore<
  Service extends object,
  Name extends AsyncMethodName<Service>,
>(
  service: Service,
  method: Name,
  gateFor: (
    call: number,
    args: Parameters<Extract<Service[Name], AsyncMethod>>,
  ) => RaceGate | undefined,
): () => void {
  const real: unknown = Reflect.get(service, method);
  if (typeof real !== 'function') {
    throw new Error(`${method} is not a method of the held service`);
  }
  const owned = Object.prototype.hasOwnProperty.call(service, method);
  let call = 0;
  Reflect.defineProperty(service, method, {
    configurable: true,
    writable: true,
    value: async (
      ...args: Parameters<Extract<Service[Name], AsyncMethod>>
    ): Promise<unknown> => {
      const gate = gateFor(call, args);
      call += 1;
      await gate?.hold();
      const result: unknown = await Reflect.apply(real, service, args);
      return result;
    },
  });
  return () => {
    if (owned) {
      Reflect.defineProperty(service, method, {
        configurable: true,
        writable: true,
        value: real,
      });
    } else {
      Reflect.deleteProperty(service, method);
    }
  };
}
