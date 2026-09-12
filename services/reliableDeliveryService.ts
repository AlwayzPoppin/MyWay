/**
 * Shared delivery scheduler for durable local queues. Each feature owns its
 * payload and idempotency key; this service only decides when recovery runs.
 */
type Flusher = () => Promise<void>;

const flushers = new Map<string, { priority: number; flush: Flusher }>();
let initialized = false;
let flushing = false;

export const flushReliableDelivery = async (): Promise<void> => {
    if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return;
    flushing = true;
    try {
        const tasks = [...flushers.entries()].sort(([, a], [, b]) => b.priority - a.priority);
        for (const [name, task] of tasks) {
            try {
                await task.flush();
            } catch (error) {
                // One queue must not prevent safety-critical or independent
                // queues from attempting their own recovery.
                console.warn(`[Delivery] ${name} recovery will retry:`, error);
            }
        }
    } finally {
        flushing = false;
    }
};

const initialize = () => {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    const trigger = () => void flushReliableDelivery();
    window.addEventListener('online', trigger);
    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') trigger();
    });
    window.setInterval(trigger, 30_000);
    queueMicrotask(trigger);
};

export const registerReliableDeliveryFlusher = (name: string, priority: number, flush: Flusher): (() => void) => {
    flushers.set(name, { priority, flush });
    initialize();
    void flushReliableDelivery();
    return () => flushers.delete(name);
};

export const requestReliableDeliveryFlush = (): void => {
    void flushReliableDelivery();
};

