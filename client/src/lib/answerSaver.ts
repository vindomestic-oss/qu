import { ApiError } from '../api/client';
import { submitChoiceAnswer, submitTextAnswer } from '../api/participant';

export type Payload = { kind: 'text'; text: string } | { kind: 'choice'; ids: number[] };

interface QueueState {
  /** Requests on their way; more than one only after an immediate (page-exit) save. */
  inFlight: number;
  sending: Payload | null;
  queued: { payload: Payload; keepalive: boolean } | null;
  confirmed: Payload | null;
  lastFailed: boolean;
  /** The intent whose save failed last, kept for retryFailed(). */
  failedPayload: Payload | null;
  /** Number of the newest request sent; only its outcome changes confirmed / failed. */
  sentSeq: number;
}

interface Handlers {
  /** superseded: a newer intent is already waiting, so the UI must keep showing that one. */
  onConfirmed: (questionId: number, payload: Payload, info: { superseded: boolean }) => void;
  onFailed: (questionId: number, confirmed: Payload | null, error: unknown) => void;
  onSubmitted: () => void;
}

interface SaveOptions {
  keepalive?: boolean;
  /** Send now even if a request is on its way (the page is going away, a queued save would never leave). */
  immediate?: boolean;
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

  save(questionId: number, payload: Payload, { keepalive = false, immediate = false }: SaveOptions = {}): void {
    const q = this.state(questionId);
    if (q.inFlight && !immediate) {
      q.queued = { payload, keepalive };
      return;
    }
    q.queued = null;
    void this.send(questionId, payload, keepalive);
  }

  /** The newest intent for a question: queued, else in flight, else what the server confirmed. */
  latest(questionId: number): Payload | null {
    const q = this.queues.get(questionId);
    return q ? (q.queued?.payload ?? q.sending ?? q.confirmed) : null;
  }

  /** What the server has confirmed for a question. */
  confirmedOf(questionId: number): Payload | null {
    return this.queues.get(questionId)?.confirmed ?? null;
  }

  isBusy(questionId: number): boolean {
    const q = this.queues.get(questionId);
    return Boolean(q && (q.inFlight > 0 || q.queued));
  }

  /** Page exit: every waiting intent leaves at once with keepalive (a queued one would never be sent). */
  sendQueuedNow(): void {
    for (const [id, q] of this.queues) {
      if (!q.queued) continue;
      const { payload } = q.queued;
      q.queued = null;
      void this.send(id, payload, true);
    }
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
      q = { inFlight: 0, sending: null, queued: null, confirmed: null, lastFailed: false, failedPayload: null, sentSeq: 0 };
      this.queues.set(questionId, q);
    }
    return q;
  }

  private idle(): boolean {
    return [...this.queues.values()].every((q) => !q.inFlight && !q.queued);
  }

  private async send(questionId: number, payload: Payload, keepalive: boolean): Promise<void> {
    const q = this.state(questionId);
    q.sentSeq += 1;
    const seq = q.sentSeq;
    const newest = () => seq === q.sentSeq;
    q.inFlight += 1;
    q.sending = payload;
    try {
      if (payload.kind === 'text') await submitTextAnswer(questionId, payload.text, { keepalive });
      else await submitChoiceAnswer(questionId, payload.ids, { keepalive });
      if (newest()) {
        q.confirmed = payload;
        q.lastFailed = false;
        q.failedPayload = null;
        this.handlers.onConfirmed(questionId, payload, { superseded: q.queued !== null });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already submitted (another tab, or the session ended): nothing more can be saved.
        q.queued = null;
        q.lastFailed = false;
        q.failedPayload = null;
        this.handlers.onSubmitted();
      } else if (newest() && !q.queued) {
        q.lastFailed = true;
        q.failedPayload = payload;
        this.handlers.onFailed(questionId, q.confirmed, err);
      }
    } finally {
      q.inFlight -= 1;
      if (!q.inFlight) q.sending = null;
    }
    // While a newer request is still on its way, that one finishes the job.
    if (q.inFlight) return;
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
