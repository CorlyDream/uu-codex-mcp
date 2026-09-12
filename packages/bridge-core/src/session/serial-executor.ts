/**
 * Process-wide FIFO executor used by the GUI transport MVP.
 * A rejected task is absorbed into the tail so later work is never poisoned.
 */
export class SerialExecutor {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const current = this.tail.then(task, task);
    this.tail = current.then(() => undefined, () => undefined);
    return current;
  }
}
