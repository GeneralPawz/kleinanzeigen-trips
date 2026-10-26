/**
 * Sequential queue that spaces tasks by a (jittered) delay measured from the end of the previous one.
 * @param {[number,number]} range [minMs, maxMs]
 */
export function createQueue(range) {
  let tail = Promise.resolve();
  let last = 0;
  const q = {
    range,
    setDelay(min, max) {
      q.range = [min, max];
    },
    /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
    enqueue(fn) {
      const run = tail.then(async () => {
        const wait = last + q.range[0] + Math.random() * (q.range[1] - q.range[0]) - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        try {
          return await fn();
        } finally {
          last = Date.now();
        }
      });
      tail = run.catch(() => {});
      return run;
    },
  };
  return q;
}
