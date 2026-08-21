import { markDispatchHeard } from "./radio";

export type QueuedAudioSource = "live" | "manual";

export type QueuedAudio = {
  id: string;
  driverId: string;
  driverName: string;
  audioBase64: string;
  contentType: string;
  source: QueuedAudioSource;
  /** Mark dispatchHeardAt when this item starts playing. */
  markHeard: boolean;
};

export type AudioQueueState = {
  current: QueuedAudio | null;
  pending: number;
  playing: boolean;
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
      error: this.error,
    };
  }

  /** Enqueue a clip. Same id already playing or queued is ignored. */
  enqueue(item: QueuedAudio): void {
    if (!item.audioBase64) return;
    if (this.current?.id === item.id) return;
    if (this.idsInFlight.has(item.id)) return;
    this.idsInFlight.add(item.id);
    this.pending.push(item);
    this.notify();
    void this.pump();
  }

  /** True if this clip id is playing or waiting in the queue. */
  has(id: string): boolean {
    return this.current?.id === id || this.idsInFlight.has(id);
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
      this.error = null;
      this.notify();
      void this.pump();
    };
    window.addEventListener("pointerdown", resume, { once: true });
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

        if (next.markHeard) {
          void markDispatchHeard(next.id).catch(() => undefined);
        }

        const audio = new Audio(
          `data:${next.contentType};base64,${next.audioBase64}`
        );
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
            // Keep clip at front; resume after a user gesture unlocks audio.
            this.pending.unshift(next);
            this.error = "Click once on the page to unlock live radio audio";
            this.notify();
            this.armUnlockRetry();
            break;
          }
          this.idsInFlight.delete(next.id);
          this.error = "Could not play radio audio";
          this.notify();
          continue;
        }

        const result = await finished;
        if (result === "error" && !this.error) {
          this.error = "Could not play radio audio";
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
