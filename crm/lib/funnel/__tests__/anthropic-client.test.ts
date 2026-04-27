import { describe, it, expect, vi } from "vitest";
import { callWithRetry } from "../anthropic-client";

describe("callWithRetry", () => {
  it("returns result on success", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");
    const result = await callWithRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and eventually succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce("ok");
    const result = await callWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max retries on persistent 429", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    await expect(callWithRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-429 errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(callWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
