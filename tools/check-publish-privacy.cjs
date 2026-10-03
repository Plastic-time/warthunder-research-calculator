const { execFileSync } = require("node:child_process");
const staged = process.argv.includes("--staged");
const git = args => execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024 });
// Exact, reviewed literals only; these exceptions never apply to other files.
const reviewedEmails = new Map([
  ["tools/check-commit-privacy.cjs", new Set(["noreply@github.com"])],
  ["tools/test-commit-privacy.cjs", new Set(["noreply@github.com", "private@example.test", "noreply@github.com.example.test", "unreviewed@example.test"])],
  ["tools/check-publish-privacy.cjs", new Set(["noreply@github.com", "private@example.test", "noreply@github.com.example.test", "unreviewed@example.test"])],
]);
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["access token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/],
  ["credential URL", /https?:\/\/[^\s/:"'<>]+:[^\s/@"'<>]+@/],
  ["personal directory", /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/],
];
try {
  const files = git(staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "-z"])
    .toString("utf8").split("\0").filter(Boolean);
  let failures = 0;
  for (const file of files) {
    if (/(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?)$|\.(pem|pfx|key)$/i.test(file)) {
      console.error(`Blocked credential filename: ${file}`); failures++; continue;
    }
    const content = git(["show", `:${file}`]);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    for (const [kind, pattern] of patterns) {
      if (pattern.test(text)) { console.error(`Possible ${kind} in ${file}; value redacted`); failures++; }
    }
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    if (emails.some(value => !/@users\.noreply\.github\.com$/i.test(value) && !reviewedEmails.get(file)?.has(value))) {
      console.error(`Unreviewed email address in ${file}; value redacted`); failures++;
    }
  }
  if (failures) process.exitCode = 1;
  else console.log(`Publish privacy scan passed (${files.length} files checked).`);
} catch {
  console.error("Privacy scan could not inspect the Git index; refusing to publish.");
  process.exitCode = 1;
}
