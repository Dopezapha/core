import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { sleep, toMessage } from "../shared";
import type { AccountInfo } from "./types";
import { getAccount } from "./getAccount";

const MIN_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const ADAPTIVE_INTERVAL_STEP_MS = 1_000;

/**
 * Configuration for account streaming.
 */
export interface AccountStreamConfig {
  /**
   * Polling interval in milliseconds. Default: 5000 (5 seconds).
   * Minimum enforced: 1000 ms to avoid hammering Horizon.
   */
  intervalMs?: number;
  /**
   * Minimum polling interval in milliseconds when adaptive polling is enabled.
   * Default: 1000 ms.
   */
  minIntervalMs?: number;
  /**
   * Maximum polling interval in milliseconds when adaptive polling is enabled.
   * Default: the base interval.
   */
  maxIntervalMs?: number;
  /**
   * Number of unchanged polls before increasing the interval.
   * Default: 3.
   */
  adaptiveThreshold?: number;
  /**
   * Maximum number of polls before the stream ends.
   * Omit for an infinite stream.
   */
  maxPolls?: number;
  /**
   * If true, emit the current account state immediately on start.
   * Default: true.
   */
  emitOnStart?: boolean;
}

/**
 * Stream account state by polling Horizon at a configurable interval.
 *
 * Yields SorokitResult<AccountInfo> on every poll. Errors mid-stream are
 * yielded as error results — the stream does not stop on a single failure.
 *
 * Use `for await...of` to consume:
 * @example
 * for await (const result of streamAccount(horizonUrl, publicKey)) {
 *   if (result.status === 'ok') console.log(result.data.balances);
 * }
 *
 * To stop early, `break` out of the loop or use an AbortSignal:
 * @example
 * const ac = new AbortController();
 * for await (const result of streamAccount(horizonUrl, publicKey, {}, ac.signal)) { ... }
 * ac.abort();
 */
export async function* streamAccount(
  horizonUrl: string,
  publicKey: string,
  config?: AccountStreamConfig,
  signal?: AbortSignal,
): AsyncGenerator<SorokitResult<AccountInfo>> {
  const baseIntervalMs = Math.max(
    config?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
  const adaptiveEnabled =
    config?.minIntervalMs !== undefined ||
    config?.maxIntervalMs !== undefined ||
    config?.adaptiveThreshold !== undefined;
  const minIntervalMs = Math.max(
    config?.minIntervalMs ?? MIN_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
  const maxIntervalMs = Math.max(
    config?.maxIntervalMs ?? baseIntervalMs,
    minIntervalMs,
  );
  const adaptiveThreshold = Math.max(config?.adaptiveThreshold ?? 3, 1);
  const maxPolls = config?.maxPolls;
  const emitOnStart = config?.emitOnStart ?? true;

  let polls = 0;
  let currentIntervalMs = Math.min(
    Math.max(baseIntervalMs, minIntervalMs),
    maxIntervalMs,
  );
  let unchangedPolls = 0;
  let lastSnapshot: string | null = null;

  const adjustInterval = (changed: boolean): void => {
    if (!adaptiveEnabled) return;

    if (changed) {
      unchangedPolls = 0;
      currentIntervalMs = Math.max(
        minIntervalMs,
        currentIntervalMs - ADAPTIVE_INTERVAL_STEP_MS,
      );
      return;
    }

    unchangedPolls++;
    if (unchangedPolls < adaptiveThreshold) return;

    unchangedPolls = 0;
    currentIntervalMs = Math.min(
      maxIntervalMs,
      currentIntervalMs + ADAPTIVE_INTERVAL_STEP_MS,
    );
  };

  while (true) {
    if (signal?.aborted) return;

    // Respect maxPolls limit
    if (maxPolls !== undefined && polls >= maxPolls) return;

    // Skip the initial sleep when emitOnStart is true
    if (polls > 0 || !emitOnStart) {
      try {
        await sleep(currentIntervalMs);
      } catch {
        return;
      }
    }

    if (signal?.aborted) return;

    try {
      const result = await getAccount(horizonUrl, publicKey);
      const snapshot =
        result.status === "ok" ? JSON.stringify(result.data) : null;
      if (lastSnapshot !== null) {
        adjustInterval(snapshot !== lastSnapshot);
      }
      lastSnapshot = snapshot;
      yield result;
    } catch (cause) {
      adjustInterval(false);
      yield err(
        SorokitErrorCode.ACCOUNT_FETCH_FAILED,
        `Account stream poll failed: ${toMessage(cause)}`,
        cause,
      );
    }

    polls++;
  }
}
