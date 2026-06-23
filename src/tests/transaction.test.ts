import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionPage } from "../transaction/streamTransactions";

const transactionMockState = vi.hoisted(() => ({
  sleepCalls: [] as number[],
  pages: [] as TransactionPage[],
  index: 0,
}));

vi.mock("../shared", async () => {
  const actual = await vi.importActual<typeof import("../shared")>("../shared");
  return {
    ...actual,
    sleep: vi.fn((ms: number) => {
      transactionMockState.sleepCalls.push(ms);
      return Promise.resolve();
    }),
  };
});

vi.mock("@stellar/stellar-sdk", () => {
  class Server {
    constructor() {}

    transactions() {
      const buildCall = async () => {
        const page =
          transactionMockState.pages[transactionMockState.index] ??
          transactionMockState.pages.at(-1)!;
        transactionMockState.index++;
        return {
          records: page.transactions.map((tx, index) => ({
            hash: tx.hash,
            successful: tx.status === "success",
            ledger_attr: tx.ledger,
            created_at: tx.createdAt,
            fee_charged: tx.fee,
            envelope_xdr: tx.envelopeXdr ?? "",
            result_xdr: tx.resultXdr ?? "",
            paging_token:
              index === page.transactions.length - 1
                ? page.nextCursor
                : `${page.nextCursor ?? "0"}-${index}`,
          })),
        };
      };

      const builder = {
        call: buildCall,
        cursor: () => builder,
      };

      return {
        forAccount: () => ({
          limit: () => ({
            order: () => builder,
          }),
        }),
      };
    }
  }

  return { Horizon: { Server } };
});

import { streamTransactions } from "../transaction/streamTransactions";

function createPage(nextCursor: string | null, hashSuffix: string): TransactionPage {
  return {
    transactions: [
      {
        hash: `hash-${hashSuffix}`,
        status: "success",
        ledger: 1000,
        createdAt: "2024-01-01T00:00:00Z",
        fee: "100",
      },
    ],
    nextCursor,
  };
}

beforeEach(() => {
  transactionMockState.sleepCalls.length = 0;
  transactionMockState.index = 0;
  transactionMockState.pages = [];
});

describe("streamTransactions", () => {
  it("increases interval after unchanged polls and decreases after activity", async () => {
    transactionMockState.pages = [
      createPage("1", "a"),
      createPage("1", "a"),
      createPage("1", "a"),
      createPage("2", "b"),
    ];

    const stream = streamTransactions("https://horizon.test", "G...", {
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

    expect(transactionMockState.sleepCalls).toEqual([2000, 2000, 3000]);
  });

  it("respects interval boundaries", async () => {
    transactionMockState.pages = [
      createPage("1", "a"),
      createPage("1", "a"),
      createPage("1", "a"),
      createPage("1", "a"),
      createPage("2", "b"),
      createPage("2", "b"),
      createPage("2", "b"),
      createPage("2", "b"),
    ];

    const stream = streamTransactions("https://horizon.test", "G...", {
      intervalMs: 2000,
      minIntervalMs: 1000,
      maxIntervalMs: 3000,
      adaptiveThreshold: 1,
      maxPolls: 8,
    });

    for (let i = 0; i < 8; i++) {
      await stream.next();
    }

    expect(transactionMockState.sleepCalls).toEqual([
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
