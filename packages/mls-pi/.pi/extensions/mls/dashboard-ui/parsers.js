/**
 * Test output parsers — detect framework and extract structured results.
 */

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\[[\d;]*m/g, ""); }

function parseTestOutput(stdout) {
  if (!stdout) return null;
  stdout = stripAnsi(stdout);
  if (/Test Files\s+\d/.test(stdout) || /Tests\s+\d+\s+passed/.test(stdout)) return parseVitest(stdout);
  if (/test result:.*\d+ passed/.test(stdout)) return parseCargo(stdout);
  if (/={3,}.*test session/m.test(stdout) || /passed.*failed.*error/i.test(stdout)) return parsePytest(stdout);
  if (/\d+ examples?,\s*\d+ failures?/.test(stdout)) return parseRspec(stdout);
  if (/Tests run:\s*\d+/.test(stdout)) return parseJunit(stdout);
  if (/^(ok|FAIL)\s+\S+/m.test(stdout) && /--- (PASS|FAIL)/.test(stdout)) return parseGoTest(stdout);
  return null;
}

function parseVitest(stdout) {
  const files = [];
  const lines = stdout.split("\n");
  let currentFile = null;
  let currentTest = null;
  const summary = { passed: 0, failed: 0, total: 0, duration: "" };

  for (const line of lines) {
    const fileMatch = line.match(/^\s*([✓✗❯⠿])\s+(.+?)\s+\((\d+)\s+tests?(?:\s*\|\s*(\d+)\s+failed)?\)\s+(\d+m?s)/);
    if (fileMatch) {
      const [, icon, filePath, testCount, failCount, duration] = fileMatch;
      currentFile = { path: filePath, status: icon === "✓" ? "pass" : "fail", testCount: +testCount, failCount: +(failCount || 0), duration, tests: [], expanded: icon !== "✓" };
      files.push(currentFile);
      currentTest = null;
      continue;
    }
    const testMatch = line.match(/^\s+[×✕]\s+(.+)/);
    if (testMatch && currentFile) {
      currentTest = { name: testMatch[1].trim(), status: "fail", error: "" };
      currentFile.tests.push(currentTest);
      continue;
    }
    const errorMatch = line.match(/^\s+→\s+(.+)/);
    if (errorMatch && currentTest) {
      currentTest.error = (currentTest.error ? currentTest.error + "\n" : "") + errorMatch[1];
      continue;
    }
    const testSummary = line.match(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?\s+\((\d+)\)/);
    if (testSummary) { summary.passed = +testSummary[1]; summary.failed = +(testSummary[2] || 0); summary.total = +testSummary[3]; }
    const dur = line.match(/Duration\s+(.+)/);
    if (dur) summary.duration = dur[1].trim();
  }
  return files.length || summary.total ? { files, summary } : null;
}

function parsePytest(stdout) {
  const files = [];
  const fileMap = {};
  const summary = { passed: 0, failed: 0, total: 0, duration: "" };

  for (const line of stdout.split("\n")) {
    const resultMatch = line.match(/^(.+?::[\w_]+(?:\[.+?\])?)\s+(PASSED|FAILED|ERROR)/);
    if (resultMatch) {
      const [, fullName, result] = resultMatch;
      const parts = fullName.split("::");
      const filePath = parts[0];
      const testName = parts.slice(1).join("::");
      if (!fileMap[filePath]) { fileMap[filePath] = { path: filePath, status: "pass", testCount: 0, failCount: 0, duration: "", tests: [], expanded: false }; files.push(fileMap[filePath]); }
      const file = fileMap[filePath];
      file.testCount++;
      const status = result === "PASSED" ? "pass" : "fail";
      if (status === "fail") { file.failCount++; file.status = "fail"; file.expanded = true; }
      file.tests.push({ name: testName, status, error: "" });
    }
    const sumMatch = line.match(/(\d+) passed(?:.*?(\d+) failed)?(?:.*?(\d+) error)?.*in ([\d.]+s)/);
    if (sumMatch) { summary.passed = +(sumMatch[1] || 0); summary.failed = +(sumMatch[2] || 0) + +(sumMatch[3] || 0); summary.total = summary.passed + summary.failed; summary.duration = sumMatch[4]; }
  }
  return files.length || summary.total ? { files, summary } : null;
}

function parseCargo(stdout) {
  const files = [];
  const summary = { passed: 0, failed: 0, total: 0, duration: "" };
  const fileMap = {};

  for (const line of stdout.split("\n")) {
    const testMatch = line.match(/^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED)/);
    if (testMatch) {
      const [, name, result] = testMatch;
      const mod = name.includes("::") ? name.split("::").slice(0, -1).join("::") : "tests";
      if (!fileMap[mod]) { fileMap[mod] = { path: mod, status: "pass", testCount: 0, failCount: 0, duration: "", tests: [], expanded: false }; files.push(fileMap[mod]); }
      const file = fileMap[mod];
      file.testCount++;
      const status = result === "ok" ? "pass" : "fail";
      if (status === "fail") { file.failCount++; file.status = "fail"; file.expanded = true; }
      file.tests.push({ name: name.split("::").pop(), status, error: "" });
    }
    const sumMatch = line.match(/test result:.*?(\d+) passed;\s*(\d+) failed/);
    if (sumMatch) { summary.passed = +sumMatch[1]; summary.failed = +sumMatch[2]; summary.total = summary.passed + summary.failed; }
  }
  return files.length || summary.total ? { files, summary } : null;
}

function parseGoTest(stdout) {
  const files = [];
  const summary = { passed: 0, failed: 0, total: 0, duration: "" };
  const fileMap = {};

  for (const line of stdout.split("\n")) {
    const testMatch = line.match(/--- (PASS|FAIL):\s+(\S+)\s+\(([\d.]+s)\)/);
    if (testMatch) {
      const [, result, name, dur] = testMatch;
      const pkg = "tests";
      if (!fileMap[pkg]) { fileMap[pkg] = { path: pkg, status: "pass", testCount: 0, failCount: 0, duration: "", tests: [], expanded: false }; files.push(fileMap[pkg]); }
      const file = fileMap[pkg];
      file.testCount++;
      const status = result === "PASS" ? "pass" : "fail";
      if (status === "fail") { file.failCount++; file.status = "fail"; file.expanded = true; }
      file.tests.push({ name, status, error: "" });
      if (status === "pass") summary.passed++; else summary.failed++;
      summary.total++;
    }
    const pkgMatch = line.match(/^(ok|FAIL)\s+\S+\s+([\d.]+s)/);
    if (pkgMatch) summary.duration = pkgMatch[2];
  }
  return files.length || summary.total ? { files, summary } : null;
}

function parseRspec(stdout) {
  const files = [];
  const summary = { passed: 0, failed: 0, total: 0, duration: "" };
  const sumMatch = stdout.match(/(\d+) examples?,\s*(\d+) failures?(?:.*?(\d+) pending)?/);
  if (sumMatch) { summary.total = +sumMatch[1]; summary.failed = +sumMatch[2]; summary.passed = summary.total - summary.failed; }
  const durMatch = stdout.match(/Finished in ([\d.]+\s*\w+)/);
  if (durMatch) summary.duration = durMatch[1];
  // RSpec doesn't group by file easily in default output — return summary only
  return summary.total ? { files, summary } : null;
}

function parseJunit(stdout) {
  const files = [];
  const summary = { passed: 0, failed: 0, total: 0, duration: "" };
  const sumMatch = stdout.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+)(?:,\s*Errors:\s*(\d+))?/);
  if (sumMatch) { summary.total = +sumMatch[1]; summary.failed = +(sumMatch[2] || 0) + +(sumMatch[3] || 0); summary.passed = summary.total - summary.failed; }
  const durMatch = stdout.match(/Time elapsed:\s*([\d.]+\s*\w+)/);
  if (durMatch) summary.duration = durMatch[1];
  return summary.total ? { files, summary } : null;
}
