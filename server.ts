import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const thread = z.object({ threadId: z.string().min(1) });
const target = thread.extend({ seq: z.number().int().nonnegative() });
const summary = z.object({
  id: z.number().int(), seq: z.number().int(), role: z.enum(["user", "assistant"]),
  preview: z.string(), pinnedAt: z.number(),
});
export type PinSummary = z.infer<typeof summary>;
export const rpcContract = defineRpcContract({
  overview: { input: thread, output: z.object({ count: z.number(), first: summary.nullable() }) },
  list: {
    input: thread.extend({ after: z.number().int().nonnegative().default(0) }),
    output: z.object({ pins: z.array(summary), next: z.number().nullable() }),
  },
  get: { input: target, output: summary.extend({ text: z.string() }).nullable() },
  pin: { input: target, output: z.null() },
  unpin: { input: target, output: z.null() },
  toggle: { input: target, output: z.boolean() },
});

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT NOT NULL,
      seq INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
      preview TEXT NOT NULL, pinnedAt INTEGER NOT NULL, UNIQUE(threadId, seq)
    )`,
    `CREATE INDEX pins_thread_order ON pins(threadId, id)`,
  ]);
  const fields = "id, seq, role, preview, pinnedAt";
  const changed = (threadId: string) => bb.realtime.publish("pins-changed", { threadId });
  const pin = async ({ threadId, seq }: { threadId: string; seq: number }) => {
    if (db.prepare("SELECT 1 FROM pins WHERE threadId = ? AND seq = ?").get(threadId, seq)) return null;
    const { message } = await bb.sdk.threads.message({ threadId, seq, before: 0, after: 0 });
    db.prepare(`INSERT INTO pins (threadId, seq, role, text, preview, pinnedAt)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(threadId, seq) DO NOTHING`)
      .run(threadId, seq, message.role, message.text, message.text.trim().split(/\r?\n/).slice(0, 2).join("\n"), Date.now());
    changed(threadId);
    return null;
  };
  const unpin = ({ threadId, seq }: { threadId: string; seq: number }) => {
    db.prepare("DELETE FROM pins WHERE threadId = ? AND seq = ?").run(threadId, seq);
    changed(threadId);
    return null;
  };
  bb.cli.register({
    name: "pinned-messages", summary: "Manage pinned messages",
    commands: [
      { name: "pin", summary: "Pin a message", usage: "bb pinned-messages pin <thread-id> <message-seq>" },
      { name: "unpin", summary: "Unpin a message", usage: "bb pinned-messages unpin <thread-id> <message-seq>" },
    ],
    async run(argv) {
      if (argv.length !== 3 || (argv[0] !== "pin" && argv[0] !== "unpin") || !argv[1] || !/^(0|[1-9]\d*)$/.test(argv[2]!) || !Number.isSafeInteger(Number(argv[2]))) {
        return { exitCode: 1, stderr: "Usage: bb pinned-messages <pin|unpin> <thread-id> <message-seq>" };
      }
      const target = { threadId: argv[1], seq: Number(argv[2]) };
      if (argv[0] === "pin") await pin(target);
      else unpin(target);
      return { exitCode: 0, stdout: argv[0] === "pin" ? "Message pinned." : "Message unpinned." };
    },
  });
  bb.rpc.register(rpcContract, {
    overview: ({ threadId }) => ({
      count: (db.prepare("SELECT count(*) AS count FROM pins WHERE threadId = ?").get(threadId) as { count: number }).count,
      first: (db.prepare(`SELECT ${fields} FROM pins WHERE threadId = ? ORDER BY id LIMIT 1`).get(threadId) as PinSummary | undefined) ?? null,
    }),
    list: ({ threadId, after }) => {
      const rows = db.prepare(`SELECT ${fields} FROM pins WHERE threadId = ? AND id > ? ORDER BY id LIMIT 51`).all(threadId, after) as PinSummary[];
      const pins = rows.slice(0, 50);
      return { pins, next: rows.length > 50 ? pins[pins.length - 1]!.id : null };
    },
    get: ({ threadId, seq }) => (db.prepare(`SELECT ${fields}, text FROM pins WHERE threadId = ? AND seq = ?`).get(threadId, seq) as (PinSummary & { text: string }) | undefined) ?? null,
    pin,
    toggle: async ({ threadId, seq }) => {
      const deleted = db.prepare("DELETE FROM pins WHERE threadId = ? AND seq = ?").run(threadId, seq);
      if (deleted.changes) { changed(threadId); return false; }
      await pin({ threadId, seq });
      return true;
    },
    unpin,
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    db.prepare("DELETE FROM pins WHERE threadId = ?").run(thread.id);
    changed(thread.id);
  });
}
