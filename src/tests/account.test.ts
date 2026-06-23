import { describe, it, expect, vi } from "vitest";
import { formatAddress, deepEqual } from "../shared/utils";

vi.mock("../account/getAccount", () => ({
  getAccount: vi.fn(),
}));

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

  describe("deepEqual", () => {
    it("returns true for identical plain objects", () => {
      expect(deepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(true);
    });

    it("returns false for objects with different values", () => {
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it("returns true for same reference", () => {
      const obj = { a: 1 };
      expect(deepEqual(obj, obj)).toBe(true);
    });

    it("returns false for objects with different keys", () => {
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    it("handles nested differences in balances", () => {
      const a = { sequence: "1", balances: [{ balance: "100" }] };
      const b = { sequence: "1", balances: [{ balance: "200" }] };
      expect(deepEqual(a, b)).toBe(false);
    });

    it("returns true for identical nested objects", () => {
      const a = { sequence: "1", balances: [{ balance: "100" }] };
      const b = { sequence: "1", balances: [{ balance: "100" }] };
      expect(deepEqual(a, b)).toBe(true);
    });
  });

  describe("streamAccount deduplication", () => {
    it("does not re-emit when account state is unchanged", async () => {
      const { getAccount } = await import("../account/getAccount");
      const { streamAccount } = await import("../account/streamAccount");
      const { ok } = await import("../shared/response");

      const account = {
        publicKey: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA",
        displayAddress: "GAAZI...CWNA",
        sequence: "1",
        subentryCount: 0,
        balances: [{ assetType: "native" as const, assetCode: "XLM", assetIssuer: null, balance: "100", balanceFloat: 100 }],
      };

      vi.mocked(getAccount)
        .mockResolvedValueOnce(ok(account))
        .mockResolvedValueOnce(ok(account));

      const results: unknown[] = [];
      for await (const r of streamAccount("http://horizon", account.publicKey, { maxPolls: 2, emitOnStart: true, intervalMs: 1 })) {
        results.push(r);
      }

      expect(results.length).toBe(1);
    }, 10_000);

    it("emits again when account state changes", async () => {
      const { getAccount } = await import("../account/getAccount");
      const { streamAccount } = await import("../account/streamAccount");
      const { ok } = await import("../shared/response");

      const a1 = {
        publicKey: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA",
        displayAddress: "GAAZI...CWNA",
        sequence: "1",
        subentryCount: 0,
        balances: [{ assetType: "native" as const, assetCode: "XLM", assetIssuer: null, balance: "100", balanceFloat: 100 }],
      };
      const a2 = { ...a1, sequence: "2", balances: [{ assetType: "native" as const, assetCode: "XLM", assetIssuer: null, balance: "200", balanceFloat: 200 }] };

      vi.mocked(getAccount)
        .mockResolvedValueOnce(ok(a1))
        .mockResolvedValueOnce(ok(a2))
        .mockResolvedValueOnce(ok(a2));

      const results: unknown[] = [];
      for await (const r of streamAccount("http://horizon", a1.publicKey, { maxPolls: 3, emitOnStart: true, intervalMs: 1 })) {
        results.push(r);
      }

      expect(results.length).toBe(2);
    }, 10_000);
  });
});
