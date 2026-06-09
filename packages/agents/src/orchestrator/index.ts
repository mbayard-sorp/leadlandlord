/**
 * Shared orchestrator "brain" module (orchestrator Phase 3+). One module, three
 * future call sites: the tick supervisory pass (now), the operator agent, and
 * the Phase 6 chat. Avoids the parallel-system anti-pattern (plan §3.2).
 */
export * from './context';
export * from './supervisor';
export * from './disposition';
export * from './prompt';
export * from './tools';
export * from './brain';
