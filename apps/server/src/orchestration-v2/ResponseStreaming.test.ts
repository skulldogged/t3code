import { describe, expect, it } from "vite-plus/test";
import { MessageId, ThreadId, TurnItemId, ProviderDriverKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { ProviderAdapterV2Event } from "./ProviderAdapter.ts";
import { makeResponseStreamingDelivery, splitBufferedAssistantText } from "./ResponseStreaming.ts";

describe("splitBufferedAssistantText", () => {
  it("keeps a partial trailing line buffered", () => {
    expect(splitBufferedAssistantText("one\n\ntwo")).toEqual({ ready: "one\n\n", rest: "two" });
    expect(splitBufferedAssistantText("one\ntwo")).toEqual({ ready: "", rest: "one\ntwo" });
  });

  it("does not split inside an open fence and delivers the block at its closing fence", () => {
    const open = "intro\n\n```\ncode\n\nmore\n";
    expect(splitBufferedAssistantText(open)).toEqual({
      ready: "intro\n\n",
      rest: "```\ncode\n\nmore\n",
    });
    expect(splitBufferedAssistantText(`${open}\`\`\`\nafter`)).toEqual({
      ready: `${open}\`\`\`\n`,
      rest: "after",
    });
  });

  it("does not treat a fence with an info string as a closing fence", () => {
    const text = "```\n```javascript\nstill code\n\nmore\n";
    expect(splitBufferedAssistantText(text)).toEqual({ ready: "", rest: text });
  });

  it("treats a fence indented four or more spaces as code, not a closing fence", () => {
    const text = "```\n    ```\n\nstill code\n";
    expect(splitBufferedAssistantText(text)).toEqual({ ready: "", rest: text });
    expect(splitBufferedAssistantText("```\n   ```\nafter")).toEqual({
      ready: "```\n   ```\n",
      rest: "after",
    });
  });

  it("keeps a fence nested under a list item open across its blank lines", () => {
    const text = "- step\n\n    ```ts\n    a\n\n    b\n    ```\n\nafter\n";
    expect(splitBufferedAssistantText(text)).toEqual({
      ready: "- step\n\n    ```ts\n    a\n\n    b\n    ```\n\n",
      rest: "after\n",
    });
  });

  it("does not treat a no-break-space line as blank", () => {
    expect(splitBufferedAssistantText("para\n\u00a0\ncont\n\nnext")).toEqual({
      ready: "para\n\u00a0\ncont\n\n",
      rest: "next",
    });
  });

  it("treats CRLF blank lines as boundaries", () => {
    expect(splitBufferedAssistantText("one\r\n\r\ntwo")).toEqual({
      ready: "one\r\n\r\n",
      rest: "two",
    });
  });

  it("only closes a fence with the same marker of equal or greater length", () => {
    const text = "````\n```\nstill code\n\n````\n\nout\n";
    expect(splitBufferedAssistantText(text)).toEqual({
      ready: "````\n```\nstill code\n\n````\n\n",
      rest: "out\n",
    });
    expect(splitBufferedAssistantText("~~~\n```\n\nx\n")).toEqual({
      ready: "",
      rest: "~~~\n```\n\nx\n",
    });
  });
});

function message(text: string, streaming = true, id = "message") {
  return {
    type: "message.updated",
    driver: ProviderDriverKind.make("codex"),
    message: {
      createdBy: "agent",
      creationSource: "provider",
      id: MessageId.make(id),
      threadId: ThreadId.make("thread"),
      runId: null,
      nodeId: null,
      role: "assistant",
      text,
      attachments: [],
      streaming,
      createdAt: DateTime.makeUnsafe(0),
      updatedAt: DateTime.makeUnsafe(0),
    },
  } satisfies ProviderAdapterV2Event;
}

function turnItem(text: string, streaming = true) {
  return {
    type: "turn_item.updated",
    driver: ProviderDriverKind.make("codex"),
    turnItem: {
      type: "assistant_message",
      id: TurnItemId.make("item"),
      messageId: MessageId.make("message"),
      threadId: ThreadId.make("thread"),
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: streaming ? "running" : "completed",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: DateTime.makeUnsafe(0),
      text,
      streaming,
    },
  } satisfies ProviderAdapterV2Event;
}

for (const [name, snapshot] of [
  ["message", message],
  ["timeline item", turnItem],
] as const) {
  describe(`${name} response delivery`, () => {
    it("delivers stable paragraphs once and keeps the complete final response", () => {
      const deliver = makeResponseStreamingDelivery("paragraph");
      expect(deliver(snapshot("partial"))).toBeUndefined();
      expect(deliver(snapshot("first\n\npartial"))).toEqual(snapshot("first\n\n"));
      expect(deliver(snapshot("first\n\npartial extension"))).toBeUndefined();
      expect(deliver(snapshot("first\n\nsecond\n\nthird"))).toEqual(
        snapshot("first\n\nsecond\n\n"),
      );
      const final = snapshot("first\n\nsecond\n\nthird", false);
      expect(deliver(final)).toEqual(final);
    });
    it("holds turn mode output until its final snapshot", () => {
      const deliver = makeResponseStreamingDelivery("turn");
      expect(deliver(snapshot("first\n\nsecond"))).toBeUndefined();
      expect(deliver(snapshot("first\n\nsecond", false))).toEqual(
        snapshot("first\n\nsecond", false),
      );
    });
    it("forwards every token-mode snapshot", () => {
      const deliver = makeResponseStreamingDelivery("token");
      for (const text of ["a", "ab", "abc"])
        expect(deliver(snapshot(text))).toEqual(snapshot(text));
    });
    it("withholds an open code block until it closes", () => {
      const deliver = makeResponseStreamingDelivery("paragraph");
      expect(deliver(snapshot("```ts\ncode\n\nmore\n"))).toBeUndefined();
      expect(deliver(snapshot("```ts\ncode\n\nmore\n```\ntail"))).toEqual(
        snapshot("```ts\ncode\n\nmore\n```\n"),
      );
    });
  });
}

it("does not hide user messages or deduplicate different assistant messages", () => {
  const deliver = makeResponseStreamingDelivery("paragraph");
  const user = message("user text");
  const event = { ...user, message: { ...user.message, role: "user" as const } };
  expect(deliver(event)).toEqual(event);
  expect(deliver(message("same\n\n", true, "one"))).toBeDefined();
  expect(deliver(message("same\n\n", true, "two"))).toBeDefined();
});
