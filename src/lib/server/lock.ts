// One writer at a time: saves, deletes, restores and watcher commits all touch
// the files, the git index and the SQLite index, and must not interleave.

export class Mutex {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(fn: () => Promise<T> | T): Promise<T> {
		const result = this.tail.then(fn, fn);
		this.tail = result.catch(() => undefined);
		return result;
	}
}
