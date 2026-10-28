// Replay: the initial snapshot plus the recorded outside inputs reproduce a session.
import type { ModuleDef } from '../contracts/kernel';
import type { ServiceName, Services } from '../contracts/services';
import { createFakeClock } from './base-services';
import type { DataBundle } from './data';
import { createKernel, type Kernel, type Session } from './kernel';

export function replay(
  session: Session,
  modules: ModuleDef[],
  data: DataBundle,
  extraServices: Partial<{ [K in ServiceName]: Services[K] }> = {},
): Kernel {
  const clock = createFakeClock(session.initial.at);
  const k = createKernel({ data, seed: session.seed, clock });
  for (const [name, impl] of Object.entries(extraServices)) k.provide(name as ServiceName, impl as never, 'replay');
  modules.forEach((m) => k.register(m));
  k.boot({ snapshot: session.initial });
  // Each input happens at its recorded time, but timers never re-fire: their effects are already in the log.
  // Known limit: storage the modules read at init is not part of the session (DECISIONS #28).
  for (const rec of session.inputs) {
    clock.setNow(rec.at);
    k.emit(rec.type, rec.payload, rec.source);
  }
  return k;
}
