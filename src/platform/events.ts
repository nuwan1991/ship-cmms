/**
 * In-process domain event bus for decoupled reactions (e.g. M12 condition signal -> M06).
 * Handlers run synchronously AFTER the publishing transaction commits; a handler
 * failure is logged and isolated, so it can never roll back or block the publisher
 * (monitoring failures must not interrupt maintenance workflows).
 */
export interface DomainEvent<T = unknown> {
  type: string; // `<prefix>.<noun>.<past_verb>` e.g. mon.condition.breached
  occurredAt: string;
  payload: T;
}
type Handler = (e: DomainEvent) => void;

export class EventBus {
  private handlers = new Map<string, Handler[]>();
  readonly failures: Array<{ type: string; error: unknown }> = [];

  subscribe(type: string, h: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]);
  }

  publish(e: DomainEvent): void {
    for (const h of this.handlers.get(e.type) ?? []) {
      try {
        h(e);
      } catch (error) {
        this.failures.push({ type: e.type, error });
      }
    }
  }
}
