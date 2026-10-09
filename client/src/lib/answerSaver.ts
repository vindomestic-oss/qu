import { ApiError } from '../api/client';
import { submitChoiceAnswer, submitTextAnswer } from '../api/participant';

export type Payload = { kind: 'text'; text: string } | { kind: 'choice'; ids: number[] };

interface QueueState {
  inFlight: boolean;
  sending: Payload | null;
  queued: { payload: Payload; keepalive: boolean } | null;
  confirmed: Payload | null;
  lastFailed: boolean;
  /** The intent whose save failed last, kept for retryFailed(). */
  failedPayload: Payload | null;
}

interface Handlers {
  onConfirmed: (questionId: number, payload: Payload) => void;
  onFailed: (questionId: number, confirmed: Payload | null, error: unknown) => void;
  onSubmitted: () => void;
}

/**
 * One serial queue per question: at most one request in flight, and only the newest pending intent
 * waits behind it (older ones are dropped). flushAll() resolves when every queue is idle and reports
 * whether the last attempt of each question succeeded.
 */
export class AnswerSaver {
  private queues = new Map<number, QueueState>();
  private idleWaiters: (() => void)[] = [];
  private handlers: Handlers;

  constructor(handlers: Handlers) {
    this.handlers = handlers;
  }

  setHandlers(handlers: Handlers): void {
    this.handlers = handlers;
  }

  /** Seeds what the server already has (from /api/my/quiz). */
  setConfirmed(questionId: number, payload: Payload | null): void {
    const q = this.state(questionId);
    if (!q.inFlight && !q.queued) q.confirmed = payload;
  }

  save(questionId: number, payload: Payload, { keepalive = false }: { keepalive?: boolean } = {}): void {
    const q = this.state(questionId);
    if (q.inFlight) {
      q.queued = { payload, keepalive };
      return;
    }
    void this.send(questionId, payload, keepalive);
  }

  /** The newest intent for a question: queued, else in flight, else what the server confirmed. */
  latest(questionId: number): Payload | null {
    const q = this.queues.get(questionId);
    return q ? (q.queued?.payload ?? q.sending ?? q.confirmed) : null;
  }

  isBusy(questionId: number): boolean {
    const q = this.queues.get(questionId);
    return Boolean(q && (q.inFlight || q.queued));
  }

  /** Questions whose last save failed. */
  failedIds(): number[] {
    return [...this.queues].filter(([, q]) => q.lastFailed).map(([id]) => id);
  }

  /** Sends every failed intent again, unless something newer is already on its way. */
  retryFailed(): void {
    for (const [id, q] of this.queues) {
      if (q.lastFailed && q.failedPayload && !q.inFlight && !q.queued) void this.send(id, q.failedPayload, false);
    }
  }

  async flushAll(): Promise<boolean> {
    await new Promise<void>((resolve) => {
      if (this.idle()) resolve();
      else this.idleWaiters.push(resolve);
    });
    return [...this.queues.values()].every((q) => !q.lastFailed);
  }

  private state(questionId: number): QueueState {
    let q = this.queues.get(questionId);
    if (!q) {
      q = { inFlight: false, sending: null, queued: null, confirmed: null, lastFailed: false, failedPayload: null };
      this.queues.set(questionId, q);
    }
    return q;
  }

  private idle(): boolean {
    return [...this.queues.values()].every((q) => !q.inFlight && !q.queued);
  }

  private async send(questionId: number, payload: Payload, keepalive: boolean): Promise<void> {
    const q = this.state(questionId);
    q.inFlight = true;
    q.sending = payload;
    try {
      if (payload.kind === 'text') await submitTextAnswer(questionId, payload.text, { keepalive });
      else await submitChoiceAnswer(questionId, payload.ids, { keepalive });
      q.confirmed = payload;
      q.lastFailed = false;
      q.failedPayload = null;
      this.handlers.onConfirmed(questionId, payload);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already submitted (another tab, or the session ended): nothing more can be saved.
        q.queued = null;
        q.lastFailed = false;
        q.failedPayload = null;
        this.handlers.onSubmitted();
      } else if (!q.queued) {
        q.lastFailed = true;
        q.failedPayload = payload;
        this.handlers.onFailed(questionId, q.confirmed, err);
      }
    } finally {
      q.inFlight = false;
      q.sending = null;
    }
    const next = q.queued;
    q.queued = null;
    if (next) {
      void this.send(questionId, next.payload, next.keepalive);
      return;
    }
    if (this.idle()) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}
