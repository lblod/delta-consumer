import { TASK_WATCHDOG_TIMEOUT_MS } from '../config';

export class ProcessingQueue {
  constructor(name = 'Default') {
    this.name = name;
    this.queue = [];
    this.run();
    this.executing = false; //To avoid subtle race conditions TODO: is this required?
  }

  async run() {
    if (this.queue.length > 0 && !this.executing) {
      const job = this.queue.shift();
      const watchdog = this.startWatchdog();
      try {
        this.executing = true;
        console.log(`${this.name}: Executing oldest task on queue`);
        await job.task();
        console.log(`${this.name}: Remaining number of tasks ${this.queue.length}`);
      }
      catch (error) {
        await job.onError(error);
      }
      finally {
        clearInterval(watchdog);
        this.executing = false;
        this.run();
      }
    }
    else {
      setTimeout(() => { this.run(); }, (process.env.QUEUE_POLL_INTERVAL || 100));
    }
  }

  // Safety net: every network await in a task should hit its own timeout, so a
  // task running longer than this means an await escaped them (e.g. custom
  // dispatching performing a call without a timeout). We only log an error;
  // cancelling the task could let it resume concurrently with the next one.
  startWatchdog() {
    if (!TASK_WATCHDOG_TIMEOUT_MS) return null;
    const startedAt = new Date();
    return setInterval(() => {
      const minutes = Math.round((new Date() - startedAt) / 60000);
      console.error(`${this.name}: task is still running after ${minutes} minutes; it is probably stuck and blocking the queue (see DCR_TASK_WATCHDOG_TIMEOUT_MS)`);
    }, TASK_WATCHDOG_TIMEOUT_MS);
  }

  addJob(origin, onError = async (error) => { console.error(`${this.name}: Error while processing task`, error); }) {
    this.queue.push({
      task: origin,
      onError: onError
    });
  }
}
