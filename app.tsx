import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  definePluginApp, useRpc, useRealtime, useComposer, useRealtimeConnectionState,
  experimental_useAppPanel, Markdown,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { PinSummary, rpcContract } from "./server";
import { Button } from "./components/ui/button";
import { Icon } from "./components/ui/icon";

const tab = { id: "pins", context: { kind: "thread" }, availability: "action" } as const;
const report = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error));

function usePinChanges(threadId: string, refresh: () => void) {
  useRealtime("pins-changed", (payload: unknown) => {
    if (typeof payload === "object" && payload !== null && "threadId" in payload && payload.threadId === threadId) refresh();
  });
  const connection = useRealtimeConnectionState();
  useEffect(() => { if (connection === "connected") refresh(); }, [connection, refresh]);
}

export function PinBanner({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const panel = experimental_useAppPanel();
  const [overview, setOverview] = useState<{ count: number; first: PinSummary | null } | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    rpc.call("overview", { threadId }).then(result => {
      if (request === generation.current) setOverview(result);
    }, report);
  }, [rpc, threadId]);
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [refresh]);
  usePinChanges(threadId, refresh);
  if (!overview?.first) return null;
  return <div className="mb-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
    <div className="flex items-center justify-between gap-2">
      <button type="button" className="flex items-center gap-2 text-xs font-medium hover:underline" onClick={() => panel.openTab({ tab })}>
        <Icon name="Pin" className="size-3.5" />Pinned: {overview.count}
      </button>
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => panel.openTab({ tab })}>Open</Button>
    </div>
    <div className="line-clamp-2 cursor-pointer text-sm [&_p]:m-0" onClick={event => {
      if (!(event.target instanceof Element) || !event.target.closest("a,button")) panel.openTab({ tab });
    }}>
      <Markdown content={overview.first.preview || "Message without text"} />
    </div>
  </div>;
}

function ComposerPins() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <PinBanner key={scope.threadId} threadId={scope.threadId} /> : null;
}

export function PinsPanel({ threadId }: { threadId: string }) {
  return <Pins key={threadId} threadId={threadId} />;
}

function Pins({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number } | null>(null);
  const [pins, setPins] = useState<PinSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ seq: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const updateSelection = useCallback(() => {
    const current = window.getSelection();
    const root = textRef.current;
    if (!root || !current || current.isCollapsed || !current.rangeCount || !current.anchorNode || !current.focusNode ||
        !root.contains(current.anchorNode) || !root.contains(current.focusNode) || !current.toString().trim()) {
      setSelection(null);
      return;
    }
    const range = current.getRangeAt(0);
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width || rect.height);
    const focusAtEnd = current.focusNode === range.endContainer && current.focusOffset === range.endOffset;
    const rect = (focusAtEnd ? rects[rects.length - 1] : rects[0]) ?? range.getBoundingClientRect();
    setSelection({ text: current.toString(), rect });
  }, []);
  useEffect(() => {
    document.addEventListener("selectionchange", updateSelection);
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setSelection(null); };
    const resize = () => setSelection(null);
    const pointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !popupRef.current?.contains(event.target)) setSelection(null);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", pointerDown);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("resize", resize);
    };
  }, [updateSelection]);
  useLayoutEffect(() => {
    const container = contentRef.current;
    const popup = popupRef.current;
    if (!selection || !container || !popup) { setPopupPosition(null); return; }
    const bounds = container.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = Math.max(bounds.left, Math.min(selection.rect.left + selection.rect.width / 2 - width / 2, bounds.right - width));
    const below = Math.max(bounds.top, selection.rect.bottom) + 4;
    const preferredTop = below + height <= bounds.bottom ? below : selection.rect.top - height - 4;
    const top = Math.max(bounds.top, Math.min(preferredTop, bounds.bottom - height));
    setPopupPosition({ left: left - bounds.left + container.scrollLeft, top: top - bounds.top + container.scrollTop });
  }, [selection]);
  const fail = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    rpc.call("list", { threadId, after: 0 }).then(result => {
      if (request !== generation.current) return;
      setPins(result.pins); setNext(result.next); setError(null); setLoading(false); setRevision(value => value + 1);
      setSelected(current => result.pins.some(pin => pin.seq === current) ? current : result.pins[0]?.seq ?? null);
    }, cause => { if (request === generation.current) { fail(cause); setLoading(false); } });
  }, [rpc, threadId, fail]);
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [refresh]);
  usePinChanges(threadId, refresh);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selected !== null) rpc.call("get", { threadId, seq: selected }).then(result => {
      if (active) { setDetail(result); if (!result) refresh(); }
    }, cause => { if (active) fail(cause); });
    return () => { active = false; };
  }, [rpc, threadId, selected, revision, refresh, fail]);
  async function loadMore() {
    if (next === null || pending) return;
    const request = generation.current;
    setPending(true);
    try {
      const result = await rpc.call("list", { threadId, after: next });
      if (request === generation.current) { setPins(current => [...current, ...result.pins]); setNext(result.next); }
    } catch (cause) { fail(cause); } finally { setPending(false); }
  }
  async function unpin(seq: number) {
    setPending(true);
    try { await rpc.call("unpin", { threadId, seq }); refresh(); }
    catch (cause) { fail(cause); } finally { setPending(false); }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 border-b border-border p-3">
      <h2 className="text-sm font-semibold">Pinned messages</h2>
      <p className="mt-1 text-xs text-muted-foreground">Text saved when pinned.</p>
    </div>
    {error && <div role="alert" className="p-3 text-sm text-destructive">{error} <Button variant="outline" size="sm" onClick={refresh}>Retry</Button></div>}
    {loading && pins.length === 0 ? <p role="status" className="p-4 text-sm">Loading…</p> : pins.length === 0 ?
      <p className="p-4 text-sm text-muted-foreground">Use the pin icon on a message in the chat. You can pin any number of user and assistant messages.</p> : <>
      <nav aria-label="Pinned messages" className="max-h-[35%] shrink-0 overflow-y-auto border-b border-border p-2">
        {pins.map((pin, index) => <button key={pin.seq} type="button" aria-current={selected === pin.seq ? "true" : undefined}
          className={`mb-1 block w-full rounded-md border p-2 text-left text-sm hover:bg-muted ${selected === pin.seq ? "border-primary bg-muted" : "border-transparent"}`}
          onClick={() => { setError(null); setSelection(null); setSelected(pin.seq); }}>
          <span className="mb-1 block text-xs text-muted-foreground">{index + 1}. {pin.role === "user" ? "User" : "Assistant"}</span>
          <span className="line-clamp-2 whitespace-pre-wrap break-words">{pin.preview || "Message without text"}</span>
        </button>)}
        {next !== null && <Button variant="outline" size="sm" disabled={pending} onClick={loadMore}>Show more</Button>}
      </nav>
      <div ref={contentRef} className="relative min-h-0 flex-1 overflow-y-auto p-4" key={selected} onScroll={() => setSelection(null)}>
        {detail?.seq === selected && detail ? <article className="min-w-0 break-words">
          <div className="mb-4 flex justify-end"><Button variant="outline" size="sm" disabled={pending} onClick={() => unpin(detail.seq)}><Icon name="PinOff" className="size-4" />Unpin</Button></div>
          {selection && <div ref={popupRef} role="toolbar" aria-label="Selected text actions" className="absolute z-50 rounded-md border border-border bg-popover p-1 shadow-md" style={{ left: popupPosition?.left ?? 0, top: popupPosition?.top ?? 0, visibility: popupPosition ? "visible" : "hidden" }}>
          <Button variant="ghost" size="sm" className="h-7 px-2" onMouseDown={event => event.preventDefault()} onClick={() => {
            if (composer.scope.kind !== "thread" || composer.scope.threadId !== threadId) { report(new Error("Thread composer is unavailable")); return; }
            composer.insert(`${selection.text.split("\n").map(line => `> ${line}`).join("\n")}\n\n@thread:${threadId}#msg=${detail.seq}`, { at: "end", block: true });
            setSelection(null);
          }}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></svg>Add to chat</Button></div>}
          <div ref={textRef} onMouseUp={updateSelection} onKeyUp={updateSelection}>
            {detail.text ? <Markdown content={detail.text} /> : <p className="text-sm text-muted-foreground">This message has no text.</p>}
          </div>
        </article> : <p role="status" className="text-sm text-muted-foreground">Loading message…</p>}
      </div>
    </>}
  </div>;
}

export default definePluginApp(app => {
  app.slots.messageAction({
    id: "pin", title: "Pin message", icon: "Pin",
    async run({ threadId, message }) {
      try {
        // Message actions have no hook scope; use the public plugin RPC endpoint.
        const response = await fetch("/api/v1/plugins/pinned-messages/rpc/toggle", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, seq: message.experimental_messageSeq }),
        });
        const body: unknown = await response.json();
        if (!response.ok || typeof body !== "object" || body === null || !("ok" in body) || body.ok !== true || !("result" in body) || typeof body.result !== "boolean") {
          throw new Error("Could not update pin");
        }
        toast.success(body.result ? "Message pinned" : "Message unpinned");
      } catch (cause) { report(cause); }
    },
  });
  app.slots.experimental_tab({ ...tab, title: "Pins", icon: "Pin", component: PinsPanel, layout: "flush" });
  app.slots.experimental_threadAction({
    id: "pins", title: "Pinned messages", icon: "Pin", group: "pins", placement: "header",
    item: ({ experimental_panel }) => ({ label: "Pins", icon: "Pin", run: () => { experimental_panel.openTab({ tab }); } }),
  });
  app.composer.customize({ id: "pins", banners: [{ id: "pins", component: ComposerPins }] });
});
