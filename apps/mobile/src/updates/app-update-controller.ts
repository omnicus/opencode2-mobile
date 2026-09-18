export type AppUpdateState = {
  phase: "disabled" | "idle" | "checking" | "downloading" | "current" | "ready" | "restarting";
  error?: string;
};

type UpdateService = {
  enabled: boolean;
  check: () => Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean }>;
  download: () => Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>;
  prepare: () => Promise<void>;
  reload: () => Promise<void>;
};

export const appUpdateCheckIntervalMs = 15 * 60 * 1_000;

export class AppUpdateController {
  private state: AppUpdateState;
  private listeners = new Set<() => void>();
  private operation: Promise<void> | undefined;
  private lastCheck = -Infinity;
  private downloaded = false;

  constructor(
    private readonly service: UpdateService,
    private readonly now = Date.now,
  ) {
    this.state = { phase: service.enabled ? "idle" : "disabled" };
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(state: AppUpdateState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  markDownloaded = () => {
    this.downloaded = true;
    if (this.service.enabled && !this.operation && this.state.phase !== "restarting") {
      this.setState({ phase: "ready" });
    }
  };

  check = (manual = false): Promise<void> => {
    if (this.operation) return this.operation;
    if (
      !this.service.enabled ||
      this.state.phase === "ready" ||
      this.state.phase === "restarting" ||
      (!manual && this.now() - this.lastCheck < appUpdateCheckIntervalMs)
    ) {
      return Promise.resolve();
    }
    this.lastCheck = this.now();
    this.setState({ phase: "checking" });
    this.operation = this.checkAndDownload().finally(() => {
      this.operation = undefined;
    });
    return this.operation;
  };

  private async checkAndDownload() {
    try {
      const result = await this.service.check();
      if (!result.isAvailable && !result.isRollBackToEmbedded) {
        this.setState({ phase: this.downloaded ? "ready" : "current" });
        return;
      }
      this.setState({ phase: "downloading" });
      const downloaded = await this.service.download();
      this.downloaded ||= downloaded.isNew || Boolean(downloaded.isRollBackToEmbedded);
      this.setState({
        phase: this.downloaded ? "ready" : "current",
      });
    } catch {
      this.setState({
        phase: this.downloaded ? "ready" : "idle",
        error: "Couldn't check or download an app update. Try again.",
      });
    }
  }

  restart = (): Promise<void> => {
    if (this.operation) return this.operation;
    if (this.state.phase !== "ready") return Promise.resolve();
    this.setState({ phase: "restarting" });
    this.operation = this.prepareAndReload().finally(() => {
      this.operation = undefined;
    });
    return this.operation;
  };

  private async prepareAndReload() {
    try {
      await this.service.prepare();
    } catch {
      this.setState({
        phase: "ready",
        error: "Couldn't save your draft. The app hasn't restarted.",
      });
      return;
    }
    try {
      await this.service.reload();
    } catch {
      this.setState({ phase: "ready", error: "Couldn't restart. Try again or reopen the app." });
    }
  }
}
