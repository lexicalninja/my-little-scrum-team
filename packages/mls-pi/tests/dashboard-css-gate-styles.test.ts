import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Helper: Load and parse CSS ──────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(
  __dirname,
  "../.pi/extensions/mls/dashboard-ui/style.css",
);

let css: string;

/**
 * Strip CSS comments from a string.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extract a CSS rule block for a given selector.
 * Returns the properties string (content between braces) or null.
 */
function getRuleBlock(selector: string): string | null {
  // Escape special regex chars in selector (dots, parentheses, etc.)
  const escaped = selector.replace(/([.[\](){}+*?^$|\\])/g, "\\$1");
  // Match the selector followed by { ... }
  const regex = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "m");
  const match = css.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Parse a CSS rule block into a map of property → value.
 */
function parseProperties(block: string): Record<string, string> {
  const clean = stripComments(block);
  const props: Record<string, string> = {};
  const declarations = clean.split(";").map((d) => d.trim()).filter(Boolean);
  for (const decl of declarations) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const value = decl.slice(colonIdx + 1).trim();
    props[prop] = value;
  }
  return props;
}

/**
 * Get parsed properties for a selector.
 */
function getProps(selector: string): Record<string, string> {
  const block = getRuleBlock(selector);
  if (!block) return {};
  return parseProperties(block);
}

/**
 * Collect all CSS custom property definitions (--*) from :root.
 */
function getRootVariables(): string[] {
  const rootBlock = getRuleBlock(":root");
  if (!rootBlock) return [];
  const props = parseProperties(rootBlock);
  return Object.keys(props).filter((k) => k.startsWith("--"));
}

// ─── Load CSS once ───────────────────────────────────────────────────────────

beforeAll(() => {
  css = fs.readFileSync(CSS_PATH, "utf8");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Dashboard CSS — gate card & aborted badge styles", () => {
  it(".gate-card has base styles: background, border, padding, margin-bottom, border-radius", () => {
    const props = getProps(".gate-card");
    expect(props).toHaveProperty("background");
    expect(props["background"]).toContain("var(--surface)");
    expect(props).toHaveProperty("border");
    expect(props["border"]).toContain("var(--border)");
    expect(props).toHaveProperty("padding");
    expect(props).toHaveProperty("margin-bottom");
    expect(props).toHaveProperty("border-radius");
  });

  it(".gate-card.gate-waiting has left border using var(--yellow)", () => {
    const props = getProps(".gate-card.gate-waiting");
    expect(props).toHaveProperty("border-left");
    expect(props["border-left"]).toContain("var(--yellow)");
  });

  it(".gate-card.gate-approved has left border using var(--green)", () => {
    const props = getProps(".gate-card.gate-approved");
    expect(props).toHaveProperty("border-left");
    expect(props["border-left"]).toContain("var(--green)");
  });

  it(".gate-card.gate-rejected has left border using var(--red)", () => {
    const props = getProps(".gate-card.gate-rejected");
    expect(props).toHaveProperty("border-left");
    expect(props["border-left"]).toContain("var(--red)");
  });

  it(".gate-card.gate-timeout has left border using var(--dim)", () => {
    const props = getProps(".gate-card.gate-timeout");
    expect(props).toHaveProperty("border-left");
    expect(props["border-left"]).toContain("var(--dim)");
  });

  it("gate typography selectors have font/layout styles: .gate-header, .gate-icon, .gate-name, .gate-status, .gate-rounds, .gate-auto, .gate-summary", () => {
    // .gate-header — layout container
    const header = getProps(".gate-header");
    expect(header).toHaveProperty("display", "flex");
    expect(header).toHaveProperty("align-items", "center");

    // .gate-icon — font sizing
    const icon = getProps(".gate-icon");
    expect(icon).toHaveProperty("font-size");

    // .gate-name — mono font, weight, color
    const name = getProps(".gate-name");
    expect(name).toHaveProperty("font-family");
    expect(name["font-family"]).toContain("var(--font-mono)");
    expect(name).toHaveProperty("font-weight");
    expect(name).toHaveProperty("color");

    // .gate-status — mono font, muted color
    const status = getProps(".gate-status");
    expect(status).toHaveProperty("font-family");
    expect(status["font-family"]).toContain("var(--font-mono)");
    expect(status).toHaveProperty("color");

    // .gate-rounds — mono font, dim color
    const rounds = getProps(".gate-rounds");
    expect(rounds).toHaveProperty("font-family");
    expect(rounds["font-family"]).toContain("var(--font-mono)");
    expect(rounds).toHaveProperty("color");

    // .gate-auto — mono font, italic
    const auto = getProps(".gate-auto");
    expect(auto).toHaveProperty("font-family");
    expect(auto["font-family"]).toContain("var(--font-mono)");
    expect(auto).toHaveProperty("font-style", "italic");

    // .gate-summary — color, text overflow
    const summary = getProps(".gate-summary");
    expect(summary).toHaveProperty("color");
    expect(summary).toHaveProperty("overflow", "hidden");
    expect(summary).toHaveProperty("text-overflow", "ellipsis");
  });

  it(".badge.aborted has red background and text color matching review-escalated pattern", () => {
    const abortedProps = getProps(".badge.aborted");
    expect(abortedProps).toHaveProperty("background");
    expect(abortedProps).toHaveProperty("color");

    // The review-escalated pattern uses background: #d0484830
    // .badge.aborted should match this pattern
    const escalatedProps = getProps(".event.review-escalated");
    expect(abortedProps["background"]).toBe(escalatedProps["background"]);
    // Color should reference var(--red)
    expect(abortedProps["color"]).toContain("var(--red)");
  });

  it("all gate styles use existing CSS variables and introduce no new custom properties", () => {
    const rootVars = getRootVariables();

    // Collect all var(--*) references from gate-related rules
    const gateSection = css.slice(css.indexOf("/* ─── Gate Cards"));
    const varRefs = [...gateSection.matchAll(/var\(--([^)]+)\)/g)].map(
      (m) => `--${m[1]}`,
    );

    // Every referenced variable must exist in :root
    for (const ref of varRefs) {
      expect(rootVars).toContain(ref);
    }

    // No new :root variables should be defined in the gate section
    // (gate section should not contain any --* definitions)
    const gateCustomProps = [...gateSection.matchAll(/^\s*(--[\w-]+)\s*:/gm)];
    expect(gateCustomProps).toHaveLength(0);
  });
});
