import { afterEach, expect, test } from "vitest";
import { createFakePluginHost, makeThreadResponse, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
function setup() {
  let text = "[Issue](https://example.com/issues/42)\nКритерии приёмки\nПолный текст";
  const host = createFakePluginHost({
    pluginId: "pinned-messages",
    sdk: { threads: { message: async ({ threadId, seq }) => ({ before: [], after: [], message: {
      id: `m-${seq}`, kind: "conversation", role: "assistant", threadId, messageSeq: seq,
      text, createdAt: 1, startedAt: 1, sourceSeqStart: seq, sourceSeqEnd: seq,
      turnId: null, turnRequest: null, attachments: null,
    } }) } },
  });
  hosts.push(host);
  plugin(host.bb);
  return { ...host, setText: (value: string) => { text = value; }, call: host.harness.behavior.callRpc };
}
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

test("pins are idempotent snapshots, isolated by thread, persistent across reload", async () => {
  const host = setup();
  await host.call("pin", { threadId: "a", seq: 7 });
  host.setText("Редактирование исходного сообщения");
  await host.call("pin", { threadId: "a", seq: 7 });
  const reloaded = await host.harness.lifecycle.reload(plugin);
  hosts.push(reloaded);
  const call = reloaded.harness.behavior.callRpc;
  expect(await call("overview", { threadId: "a" })).toMatchObject({ count: 1 });
  expect(await call("overview", { threadId: "b" })).toEqual({ count: 0, first: null });
  expect(await call("get", { threadId: "b", seq: 7 })).toBeNull();
  const readsBefore = reloaded.harness.inspection.sdk.callsTo("threads.message").length;
  expect(await call("get", { threadId: "a", seq: 7 })).toMatchObject({
    text: "[Issue](https://example.com/issues/42)\nКритерии приёмки\nПолный текст",
    preview: "[Issue](https://example.com/issues/42)\nКритерии приёмки",
  });
  await call("list", { threadId: "a", after: 0 });
  expect(reloaded.harness.inspection.sdk.callsTo("threads.message")).toHaveLength(readsBefore);
});

test("more than 50 pins paginate without losing messages; unpin promotes next", async () => {
  const host = setup();
  for (let seq = 1; seq <= 53; seq++) await host.call("pin", { threadId: "a", seq });
  const first = await host.call("list", { threadId: "a", after: 0 }) as { pins: { seq: number }[]; next: number };
  const second = await host.call("list", { threadId: "a", after: first.next });
  expect(first.pins).toHaveLength(50);
  expect(second).toMatchObject({ pins: [{ seq: 51 }, { seq: 52 }, { seq: 53 }], next: null });
  await host.call("unpin", { threadId: "b", seq: 1 });
  expect(await host.call("overview", { threadId: "a" })).toMatchObject({ count: 53, first: { seq: 1 } });
  await host.call("unpin", { threadId: "a", seq: 1 });
  expect(await host.call("overview", { threadId: "a" })).toMatchObject({ count: 52, first: { seq: 2 } });
  await host.harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "a" }) });
  expect(await host.call("overview", { threadId: "a" })).toEqual({ count: 0, first: null });
});

test("invalid requests and unavailable source messages do not create pins", async () => {
  const host = setup();
  await expect(host.call("pin", { threadId: "a", seq: -1 })).rejects.toThrow();
  host.harness.sdk.stub("threads.message", async () => { throw new Error("message unavailable"); });
  await expect(host.call("pin", { threadId: "a", seq: 9 })).rejects.toThrow();
  expect(await host.call("overview", { threadId: "a" })).toEqual({ count: 0, first: null });
});

test("uses public SDK only", async () => {
  const scan = experimental_scanPublicSdkOnly(import.meta.dirname, { allow: [
    /^(react|sonner|@testing-library\/react|@radix-ui\/react-slot|class-variance-authority|clsx|tailwind-merge)$/,
  ] });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});

test("CLI pin is idempotent and rejects invalid sequences", async () => {
  const host = setup();
  expect((await host.harness.behavior.runCli(["pin", "a", "7"])).exitCode).toBe(0);
  host.setText("changed");
  expect((await host.harness.behavior.runCli(["pin", "a", "7"])).exitCode).toBe(0);
  expect(await host.call("overview", { threadId: "a" })).toMatchObject({ count: 1 });
  expect(await host.call("get", { threadId: "a", seq: 7 })).toMatchObject({ text: "[Issue](https://example.com/issues/42)\nКритерии приёмки\nПолный текст" });
  expect((await host.harness.behavior.runCli(["pin", "a", "-1"])).exitCode).not.toBe(0);
});

test("toggle removes and restores a pin without affecting other threads", async () => {
  const host = setup();
  expect(await host.call("toggle", { threadId: "a", seq: 7 })).toBe(true);
  await host.call("pin", { threadId: "b", seq: 7 });
  expect(await host.call("toggle", { threadId: "a", seq: 7 })).toBe(false);
  expect(await host.call("overview", { threadId: "b" })).toMatchObject({ count: 1 });
  expect(await host.call("toggle", { threadId: "a", seq: 7 })).toBe(true);
});

test("CLI unpin is idempotent, isolated by thread and rejects invalid sequences", async () => {
  const host = setup();
  await host.call("pin", { threadId: "a", seq: 7 });
  await host.call("pin", { threadId: "b", seq: 7 });
  expect((await host.harness.behavior.runCli(["unpin", "a", "7"])).exitCode).toBe(0);
  expect((await host.harness.behavior.runCli(["unpin", "a", "7"])).exitCode).toBe(0);
  expect(await host.call("overview", { threadId: "a" })).toMatchObject({ count: 0 });
  expect(await host.call("overview", { threadId: "b" })).toMatchObject({ count: 1 });
  expect((await host.harness.behavior.runCli(["unpin", "b", "-1"])).exitCode).not.toBe(0);
  expect(await host.call("overview", { threadId: "b" })).toMatchObject({ count: 1 });
});
