// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import app, { PinBanner, PinsPanel } from "./app";

const first = { id: 1, seq: 7, role: "user", preview: "Первое сообщение", pinnedAt: 1 };
const second = { id: 2, seq: 9, role: "assistant", preview: "Второе сообщение", pinnedAt: 2 };
afterEach(cleanup);

test("registers the message action, header, panel and preview", async () => {
  const registrations = await loadPluginApp(app);
  expect(registrations.messageActions.map(action => action.id)).toEqual(["pin"]);
  expect(registrations.threadActions.map(action => action.id)).toEqual(["pins"]);
  expect(registrations.tabs.map(tab => tab.id)).toEqual(["pins"]);
});

test("selects saved messages in the panel without navigating the transcript", async () => {
  const get = vi.fn(({ seq }) => ({ ...(seq === 7 ? first : second), text: `Полный текст ${seq}` }));
  const unpin = vi.fn(() => null);
  const view = renderSlot({ component: PinsPanel }, { threadId: "a" }, {
    rpc: { list: () => ({ pins: [first, second], next: null }), get, unpin },
  });
  await view.findByText("Полный текст 7");
  fireEvent.click(view.getByText("Второе сообщение"));
  await view.findByText("Полный текст 9");
  fireEvent.click(view.getByText("Unpin"));
  await waitFor(() => expect(unpin).toHaveBeenCalledWith({ threadId: "a", seq: 9 }));
  expect(view.inspection.navigateCalls).toEqual([]);
});

test("passes preview links to the host Markdown renderer; open preserves the chat", async () => {
  const openTab = vi.fn(() => true);
  const view = renderSlot({ component: PinBanner }, { threadId: "a" }, {
    rpc: { overview: () => ({ count: 2, first: { ...first, preview: "https://example.com/issues/42\nОписание задачи" } }) },
    experimental_panel: { openTab },
  });
  await view.findByText("Pinned: 2");
  // The official harness renders Markdown as plain text; real link behavior is checked live.
  expect(view.getByTestId("bb-markdown").textContent).toContain("https://example.com/issues/42");
  fireEvent.click(view.getByRole("button", { name: "Open" }));
  expect(openTab).toHaveBeenCalled();
  expect(view.inspection.navigateCalls).toEqual([]);
});
// The panel uses the thread-bound composer; selection must never submit a message.
test("adds a selected excerpt to the thread draft", async () => {
  const view = renderSlot({ component: PinsPanel }, { threadId: "a" }, {
    rpc: { list: () => ({ pins: [first], next: null }), get: () => ({ ...first, text: "Selected excerpt" }) },
  });
  await view.behavior.setComposerScope({ kind: "thread", threadId: "a" });
  const text = await view.findByText("Selected excerpt");
  const range = document.createRange();
  range.selectNodeContents(text);
  range.getBoundingClientRect = () => new DOMRect(40, 40, 100, 20);
  range.getClientRects = () => [new DOMRect(40, 40, 100, 20)] as unknown as DOMRectList;
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  fireEvent.mouseUp(text);
  expect(view.getByRole("toolbar", { name: "Selected text actions" })).toBeTruthy();
  fireEvent.click(view.getByText("Add to chat"));
  expect(view.inspection.composer.text).toContain("> Selected excerpt");
  expect(view.inspection.composer.text).toContain("@thread:a#msg=7");
});

test("dismisses the selection toolbar on scroll and Escape", async () => {
  const view = renderSlot({ component: PinsPanel }, { threadId: "a" }, {
    rpc: { list: () => ({ pins: [first], next: null }), get: () => ({ ...first, text: "Selected excerpt" }) },
  });
  const text = await view.findByText("Selected excerpt");
  const range = document.createRange();
  range.selectNodeContents(text);
  range.getBoundingClientRect = () => new DOMRect(40, 40, 100, 20);
  range.getClientRects = () => [new DOMRect(40, 40, 100, 20)] as unknown as DOMRectList;
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(text);
  expect(view.getByRole("toolbar")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(view.queryByRole("toolbar")).toBeNull();
  fireEvent.mouseUp(text);
  fireEvent.scroll(text.closest(".overflow-y-auto")!);
  expect(view.queryByRole("toolbar")).toBeNull();
});

test("positions the toolbar beside the end of a multiline selection", async () => {
  const view = renderSlot({ component: PinsPanel }, { threadId: "a" }, {
    rpc: { list: () => ({ pins: [first], next: null }), get: () => ({ ...first, text: "Selected excerpt" }) },
  });
  const text = await view.findByText("Selected excerpt");
  const container = text.closest(".overflow-y-auto") as HTMLElement;
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 400, 300));
  const range = document.createRange();
  range.selectNodeContents(text);
  range.getBoundingClientRect = () => new DOMRect(110, 110, 360, 100);
  range.getClientRects = () => [new DOMRect(300, 110, 170, 20), new DOMRect(110, 190, 100, 20)] as unknown as DOMRectList;
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(text);
  const toolbar = view.getByRole("toolbar");
  expect(Number.parseFloat(toolbar.style.left)).toBeLessThan(100);
  expect(toolbar.querySelector("svg circle")).not.toBeNull();
});

