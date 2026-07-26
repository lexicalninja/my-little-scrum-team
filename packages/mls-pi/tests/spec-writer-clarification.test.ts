import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsDir = path.join(__dirname, "..", "agents");
const specWriterPath = path.join(agentsDir, "mls-spec-writer.md");
const agentsTs = path.join(
  __dirname,
  "..",
  ".pi",
  "extensions",
  "mls",
  "agents.ts",
);

const specWriterContent = fs.readFileSync(specWriterPath, "utf-8");

/**
 * Find the character index of an h2-level "## Clarification Protocol" heading.
 * Must be at the start of a line (not ###, not indented).
 */
function findH2ClarificationIndex(content: string): number {
  const match = content.match(/^## Clarification Protocol\s*$/m);
  return match ? content.indexOf(match[0]) : -1;
}

describe("mls-spec-writer.md Clarification Protocol", () => {
  it("contains a ## Clarification Protocol section", () => {
    // The heading must be an h2 (## level) at the start of a line, not ### or indented
    const hasH2Section = /^## Clarification Protocol\s*$/m.test(
      specWriterContent,
    );
    expect(hasH2Section).toBe(true);
  });

  it("includes the exact CLARIFICATION_NEEDED: <your question> marker format", () => {
    expect(specWriterContent).toContain(
      "CLARIFICATION_NEEDED: <your question>",
    );
  });

  it("is placed between step 2 (Ask Clarifying Questions) and step 3 (Once Clarified, Create Specification) in the Workflow", () => {
    const step2Idx = specWriterContent.indexOf(
      "2. **Ask Clarifying Questions**",
    );
    const clarificationIdx = findH2ClarificationIndex(specWriterContent);
    const step3Idx = specWriterContent.indexOf(
      "3. **Once Clarified, Create Specification**",
    );

    expect(step2Idx).toBeGreaterThan(-1);
    expect(clarificationIdx).toBeGreaterThan(-1);
    expect(step3Idx).toBeGreaterThan(-1);
    expect(clarificationIdx).toBeGreaterThan(step2Idx);
    expect(clarificationIdx).toBeLessThan(step3Idx);
  });

  it("content matches the protocol already in buildSafetyPreamble() (agents.ts lines 358-365)", () => {
    // Extract the canonical protocol lines from buildSafetyPreamble in agents.ts
    const agentsTsContent = fs.readFileSync(agentsTs, "utf-8");

    // Extract the protocol body from buildSafetyPreamble (between ## Clarification Protocol and the closing backtick-semicolon)
    const preambleMatch = agentsTsContent.match(
      /## Clarification Protocol\n\n([\s\S]*?)(?:\n`;|\n##)/,
    );
    expect(preambleMatch).not.toBeNull();

    // Normalize: remove template literal escapes (\`) and leading whitespace
    const preambleLines = preambleMatch![1]
      .replace(/\\`/g, "`")
      .trim()
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    // Extract the same lines from the spec-writer markdown using the h2 heading
    const h2Regex = /^## Clarification Protocol\s*$/m;
    const h2Match = h2Regex.exec(specWriterContent);
    expect(h2Match).not.toBeNull();

    // Get content after the h2 heading until the next heading or numbered step
    const afterHeading = specWriterContent.slice(
      h2Match!.index + h2Match![0].length,
    );
    const bodyMatch = afterHeading.match(
      /^\n([\s\S]*?)(?=\n\d+\.\s|\n##|\n$)/,
    );
    expect(bodyMatch).not.toBeNull();

    const mdLines = bodyMatch![1]
      .trim()
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    expect(mdLines).toEqual(preambleLines);
  });

  it("does not modify any other agent .md files", () => {
    const otherAgents = [
      "mls-code-reviewer.md",
      "mls-designer.md",
      "mls-impl-engineer.md",
      "mls-infra-engineer.md",
      "mls-scrum-master.md",
      "mls-test-runner.md",
    ];

    for (const agentFile of otherAgents) {
      const content = fs.readFileSync(
        path.join(agentsDir, agentFile),
        "utf-8",
      );
      expect(content).not.toContain("## Clarification Protocol");
      expect(content).not.toContain("### Clarification Protocol");
    }
  });
});
