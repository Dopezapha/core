import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatAddress } from "../shared/utils";
import { ok } from "../shared/response";
import type { AccountInfo } from "../account/types";

const accountMockState = vi.hoisted(() => ({
  sleepCalls: [] as number[],
  results: [] as AccountInfo[],
  index: 0,
}));

vi.mock("../shared", async () => {
  const actual = await vi.importActual<typeof import("../shared")>("../shared");
  return {
    ...actual,
    sleep: vi.fn((ms: number) => {
      accountMockState.sleepCalls.push(ms);
      return Promise.resolve();
    }),
  };
});

vi.mock("../account/getAccount", () => ({
  getAccount: vi.fn(async () => {
    const result =
      accountMockState.results[accountMockState.index] ??
      accountMockState.results.at(-1)!;
    accountMockState.index++;
    return ok(result);
  }),
}));

import { streamAccount } from "../account/streamAccount";

function createAccount(sequence: string): AccountInfo {
  return {
    publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    displayAddress: "GAAAA...AAAA",
    sequence,
    subentryCount: 0,
    balances: [],
  };
}

beforeEach(() => {
  accountMockState.sleepCalls.length = 0;
  accountMockState.index = 0;
  accountMockState.results = [];
});

describe("account", () => {
  describe("formatAddress (pure utility — returns string, not SorokitResult)", () => {
    it("shortens a full public key", () => {
      const key = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      expect(formatAddress(key)).toContain("...");
    });

    it("returns the key unchanged if already short", () => {
      expect(formatAddress("GABCD")).toBe("GABCD");
    });
  });

  describe("streamAccount", () => {
    it("increases interval after unchanged polls and decreases after activity", async () => {
      accountMockState.results = [
        createAccount("1"),
        createAccount("1"),
        createAccount("1"),
        createAccount("2"),
      ];

      const stream = streamAccount("https://horizon.test", "G...", {
        intervalMs: 2000,
        minIntervalMs: 1000,
        maxIntervalMs: 4000,
        adaptiveThreshold: 2,
        maxPolls: 4,
      });

      await stream.next();
      await stream.next();
      await stream.next();
      await stream.next();

      expect(accountMockState.sleepCalls).toEqual([2000, 2000, 3000]);
    });

    it("respects interval boundaries", async () => {
      accountMockState.results = [
        createAccount("1"),
        createAccount("1"),
        createAccount("1"),
        createAccount("1"),
        createAccount("2"),
        createAccount("2"),
        createAccount("2"),
        createAccount("2"),
      ];

      const stream = streamAccount("https://horizon.test", "G...", {
        intervalMs: 2000,
        minIntervalMs: 1000,
        maxIntervalMs: 3000,
        adaptiveThreshold: 1,
        maxPolls: 8,
      });

      for (let i = 0; i < 8; i++) {
        await stream.next();
      }

      expect(accountMockState.sleepCalls).toEqual([
        2000,
        3000,
        3000,
        3000,
        2000,
        1000,
        1000,
      ]);
    });
  });
});
