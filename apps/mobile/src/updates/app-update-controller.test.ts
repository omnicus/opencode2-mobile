import { expect, jest, test } from "@jest/globals";

import { AppUpdateController, appUpdateCheckIntervalMs } from "./app-update-controller";

function fixture(enabled = true) {
  const service = {
    enabled,
    check: jest
      .fn<() => Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean }>>()
      .mockResolvedValue({ isAvailable: true }),
    download: jest
      .fn<() => Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>>()
      .mockResolvedValue({ isNew: true }),
    prepare: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reload: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  let time = 0;
  const controller = new AppUpdateController(service, () => time);
  return {
    service,
    controller,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("downloads independently and only restarts after explicit action and completed draft saves", async () => {
  const { controller, service } = fixture();
  await controller.check();
  expect(controller.getSnapshot().phase).toBe("ready");
  expect(service.reload).not.toHaveBeenCalled();
  let saved: (() => void) | undefined;
  service.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        saved = resolve;
      }),
  );
  const restart = controller.restart();
  expect(service.reload).not.toHaveBeenCalled();
  saved?.();
  await restart;
  expect(service.reload).toHaveBeenCalledTimes(1);
});

test("coalesces simultaneous checks and throttles foreground checks but allows manual retry", async () => {
  const { controller, service, advance } = fixture();
  service.check.mockResolvedValue({ isAvailable: false });
  await Promise.all([controller.check(), controller.check(true), controller.check()]);
  expect(service.check).toHaveBeenCalledTimes(1);
  await controller.check();
  expect(service.check).toHaveBeenCalledTimes(1);
  await controller.check(true);
  expect(service.check).toHaveBeenCalledTimes(2);
  advance(appUpdateCheckIntervalMs);
  await controller.check();
  expect(service.check).toHaveBeenCalledTimes(3);
});

test("keeps the running app on download failure and redacts exception details", async () => {
  const { controller, service } = fixture();
  service.download.mockRejectedValueOnce(new Error("private-url-and-token"));
  await controller.check();
  expect(controller.getSnapshot()).toEqual({
    phase: "idle",
    error: expect.not.stringContaining("private-url"),
  });
  expect(service.reload).not.toHaveBeenCalled();
  await controller.check(true);
  expect(controller.getSnapshot().phase).toBe("ready");
});

test("refuses to reload on a draft save failure and supports retry", async () => {
  const { controller, service } = fixture();
  await controller.check();
  service.prepare.mockRejectedValueOnce(new Error("draft write failed"));
  await controller.restart();
  expect(service.reload).not.toHaveBeenCalled();
  expect(controller.getSnapshot().phase).toBe("ready");
  await controller.restart();
  expect(service.reload).toHaveBeenCalledTimes(1);
});

test("handles rollback directives and reload failures", async () => {
  const { controller, service } = fixture();
  service.check.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: true });
  service.download.mockResolvedValue({ isNew: false, isRollBackToEmbedded: true });
  await controller.check();
  expect(controller.getSnapshot().phase).toBe("ready");
  service.reload.mockRejectedValueOnce(new Error("native failure"));
  await controller.restart();
  expect(controller.getSnapshot().phase).toBe("ready");
  expect(controller.getSnapshot().error).toContain("Couldn't restart");
});

test("recognizes a native startup download during a JavaScript check", async () => {
  const { controller, service } = fixture();
  service.check.mockResolvedValue({ isAvailable: false });
  const check = controller.check();
  controller.markDownloaded();
  await check;
  expect(controller.getSnapshot().phase).toBe("ready");
});

test("does not call native update methods in unsupported builds", async () => {
  const { controller, service } = fixture(false);
  await controller.check(true);
  controller.markDownloaded();
  await controller.restart();
  expect(controller.getSnapshot().phase).toBe("disabled");
  expect(service.check).not.toHaveBeenCalled();
  expect(service.reload).not.toHaveBeenCalled();
});
