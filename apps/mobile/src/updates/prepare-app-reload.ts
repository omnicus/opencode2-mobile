const preparations = new Set<() => Promise<void>>();
const pendingWrites = new Set<Promise<void>>();

export function registerReloadPreparation(prepare: () => Promise<void>) {
  preparations.add(prepare);
  return () => {
    preparations.delete(prepare);
  };
}

export function trackReloadWrite(write: Promise<void>) {
  pendingWrites.add(write);
  void write.then(
    () => pendingWrites.delete(write),
    () => pendingWrites.delete(write),
  );
  return write;
}

export async function prepareAppReload() {
  await Promise.all([...preparations].map((prepare) => prepare()));
  // Include writes from screens that unmounted while a settings modal opened.
  await Promise.all([...pendingWrites]);
}
