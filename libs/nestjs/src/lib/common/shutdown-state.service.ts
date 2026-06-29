import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private _isShuttingDown = false;
  private _inFlight = 0;
  private readonly drained = new Set<() => void>();
  /** AbortSignal background workers observe; aborted when shutdown begins. */
  readonly abortController = new AbortController();

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }
  get inFlight(): number {
    return this._inFlight;
  }

  beginShutdown(): void {
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;
    this.abortController.abort();
  }

  enter(): void {
    this._inFlight += 1;
  }
  leave(): void {
    this._inFlight = Math.max(0, this._inFlight - 1);
    if (this._inFlight === 0) {
      for (const resolve of this.drained) resolve();
      this.drained.clear();
    }
  }

  whenDrained(): Promise<void> {
    if (this._inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.drained.add(resolve));
  }
}
