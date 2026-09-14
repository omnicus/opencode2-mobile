// The 2.0.3 client's shared event stream requires this ES2024 method.
// Older mobile runtimes can provide Promise without providing withResolvers.
export function ensurePromiseWithResolvers() {
  if (typeof Reflect.get(Promise, "withResolvers") === "function") return;

  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    },
  });
}
