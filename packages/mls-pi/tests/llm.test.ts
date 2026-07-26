import { describe, it, expect } from "vitest";
import { parseAssistantText, parseTextDelta } from "../.pi/extensions/mls/llm.js";

describe("parseAssistantText", () => {
  it("returns string content from valid message_end", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: "Hello world" },
    });
    expect(parseAssistantText(line)).toBe("Hello world");
  });

  it("joins text blocks from array content", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Part one" },
          { type: "text", text: "Part two" },
        ],
      },
    });
    expect(parseAssistantText(line)).toBe("Part one\nPart two");
  });

  it("filters out non-text blocks in array content", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Only text" },
          { type: "tool_use", id: "123" },
        ],
      },
    });
    expect(parseAssistantText(line)).toBe("Only text");
  });

  it("returns null for non-message_end type", () => {
    const line = JSON.stringify({
      type: "message_start",
      message: { role: "assistant", content: "Hello" },
    });
    expect(parseAssistantText(line)).toBeNull();
  });

  it("returns null for non-assistant role", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "user", content: "Hello" },
    });
    expect(parseAssistantText(line)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseAssistantText("not json at all")).toBeNull();
  });

  it("returns null for empty line", () => {
    expect(parseAssistantText("")).toBeNull();
    expect(parseAssistantText("   ")).toBeNull();
  });

  it("returns null when content is neither string nor array", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: null },
    });
    expect(parseAssistantText(line)).toBeNull();
  });
});

describe("parseTextDelta", () => {
  it("returns delta from valid message_update with text_delta", () => {
    const line = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "streaming text",
      },
    });
    expect(parseTextDelta(line)).toBe("streaming text");
  });

  it("returns null when delta is missing", () => {
    const line = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
      },
    });
    expect(parseTextDelta(line)).toBeNull();
  });

  it("returns null for wrong event type", () => {
    const line = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "tool_use_delta",
        delta: "something",
      },
    });
    expect(parseTextDelta(line)).toBeNull();
  });

  it("returns null for non-message_update type", () => {
    const line = JSON.stringify({
      type: "message_end",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "text",
      },
    });
    expect(parseTextDelta(line)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseTextDelta("{broken")).toBeNull();
  });

  it("returns null for empty line", () => {
    expect(parseTextDelta("")).toBeNull();
    expect(parseTextDelta("  ")).toBeNull();
  });
});
