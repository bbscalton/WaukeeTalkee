import { markDispatchHeard } from "./radio";

export type QueuedAudioSource = "live" | "manual";

export type QueuedAudio = {
  id: string;
  driverId: string;
  driverName: string;
  audioBase64: string;
  contentType: string;
  source: QueuedAudioSource;
  /** Mark dispatchHeardAt when this item starts playing successfully. */
  markHeard: boolean;
};

export type AudioQueueState = {
  current: QueuedAudio | null;
  pending: number;
  playing: boolean;
  /** True after a user gesture successfully unlocked autoplay. */
  unlocked: boolean;
  /** Last autoplay / play failure (browser gesture policy, decode, etc.). */
  error: string | null;
};

type Listener = (state: AudioQueueState) => void;

/**
 * Single FIFO audio queue for the dispatcher: live inbound and Inbox
 * replay share one player. Never cuts the clip currently playing.
 */
class AudioQueue {
  private pending: QueuedAudio[] = [];
  private current: QueuedAudio | null = null;
  private audio: HTMLAudioElement | null = null;
  private idsInFlight = new Set<string>();
  private listeners = new Set<Listener>();
  private error: string | null = null;
  private pumping = false;
  private unlockBound = false;
  private unlocked = false;
  private unlockChain: Promise<void> = Promise.resolve();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): AudioQueueState {
    return {
      current: this.current,
      pending: this.pending.length,
      playing: this.current != null,
      unlocked: this.unlocked,
      error: this.error,
    };
  }

  /**
   * Enqueue a clip. Same id already playing or queued is ignored unless
   * `force` (Inbox replay of a stuck live clip).
   */
  enqueue(item: QueuedAudio, opts?: { force?: boolean }): void {
    if (!item.audioBase64) return;
    if (this.current?.id === item.id && !opts?.force) return;
    if (this.idsInFlight.has(item.id)) {
      if (!opts?.force) return;
      // Drop a stuck pending copy so Inbox can replay.
      this.pending = this.pending.filter((p) => p.id !== item.id);
      this.idsInFlight.delete(item.id);
      if (this.current?.id === item.id) {
        try {
          this.audio?.pause();
        } catch {
          /* ignore */
        }
        this.releaseCurrent();
      }
    }
    this.idsInFlight.add(item.id);
    this.pending.push(item);
    this.notify();
    void this.pump();
  }

  /** True if this clip id is playing or waiting in the queue. */
  has(id: string): boolean {
    return this.current?.id === id || this.idsInFlight.has(id);
  }

  /**
   * Call from a user gesture (click/tap) so the browser allows live autoplay.
   * Must finish the silent unlock BEFORE pumping, or Chrome still blocks play().
   */
  unlockFromUserGesture(): void {
    this.unlockChain = this.unlockChain
      .then(async () => {
        await this.primeSilentUnlock();
        if (this.error?.includes("unlock")) {
          this.error = null;
        }
        this.notify();
        await this.pump();
      })
      .catch(() => undefined);
  }

  private async primeSilentUnlock(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      // Tiny silent WAV — satisfies autoplay policy after a gesture.
      const silent =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      const a = new Audio(silent);
      a.volume = 0.01;
      await a.play();
      a.pause();
      this.unlocked = true;
      this.unlockBound = false;
    } catch {
      this.unlocked = false;
    }
  }

  private notify(): void {
    const state = this.snapshot();
    this.listeners.forEach((l) => l(state));
  }

  private releaseCurrent(): void {
    if (this.current) {
      this.idsInFlight.delete(this.current.id);
    }
    this.current = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }
  }

  private armUnlockRetry(): void {
    if (this.unlockBound || typeof window === "undefined") return;
    this.unlockBound = true;
    const resume = () => {
      this.unlockBound = false;
      this.unlockFromUserGesture();
    };
    window.addEventListener("pointerdown", resume, { once: true, capture: true });
    window.addEventListener("keydown", resume, { once: true, capture: true });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length > 0 && !this.audio) {
        const next = this.pending.shift()!;
        this.current = next;
        this.error = null;
        this.notify();

        const mime = next.contentType || "audio/mp4";
        const audio = new Audio(`data:${mime};base64,${next.audioBase64}`);
        audio.preload = "auto";
        audio.volume = 1;
        try {
          (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
        } catch {
          /* ignore */
        }
        this.audio = audio;

        const finished = new Promise<"ended" | "error">((resolve) => {
          audio.onended = () => resolve("ended");
          audio.onerror = () => resolve("error");
        });

        try {
          await audio.play();
        } catch (err) {
          const blocked =
            err instanceof DOMException && err.name === "NotAllowedError";
          this.current = null;
          this.audio = null;
          if (blocked) {
            this.unlocked = false;
            // Keep clip at front; resume after a user gesture unlocks audio.
            this.pending.unshift(next);
            this.error = "Click Unlock live radio to hear incoming talk";
            this.notify();
            this.armUnlockRetry();
            break;
          }
          this.idsInFlight.delete(next.id);
          this.error =
            err instanceof Error
              ? `Could not play radio audio (${err.message})`
              : "Could not play radio audio";
          this.notify();
          continue;
        }

        this.unlocked = true;
        if (next.markHeard) {
          void markDispatchHeard(next.id).catch(() => undefined);
        }

        const result = await finished;
        if (result === "error" && !this.error) {
          this.error = "Could not play radio audio (decode failed)";
        }
        this.releaseCurrent();
        this.notify();
      }
    } finally {
      this.pumping = false;
      if (!this.audio && this.pending.length > 0 && !this.unlockBound) {
        void this.pump();
      }
    }
  }
}

export const audioQueue = new AudioQueue();
