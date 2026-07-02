const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const npmCli = process.env.npm_execpath;
const tarballName = `${pkg.name.replace("/", "-").replace("@", "")}-${pkg.version}.tgz`;
const tarball = path.join(root, tarballName);

assert.ok(fs.existsSync(tarball), `missing tarball: ${tarball}`);

function runNpm(args, options = {}) {
  if (npmCli) {
    return execFileSync(process.execPath, [npmCli, ...args], options);
  }

  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}

function runBin(bin, args, options = {}) {
  return execFileSync(bin, args, { ...options, shell: process.platform === "win32" });
}

const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-pack-"));
try {
  runNpm(["install", "-g", tarball, "--prefix", prefix], {
    cwd: root,
    stdio: "pipe",
  });

  const bin = process.platform === "win32"
    ? path.join(prefix, "contextpilot.cmd")
    : path.join(prefix, "bin", "contextpilot");

  const help = runBin(bin, ["--help"], { encoding: "utf8" });
  assert.match(help, /contextpilot/);

  const setupHelp = runBin(bin, ["setup", "--help"], { encoding: "utf8" });
  assert.match(setupHelp, /One-time project setup/);

  const project = fs.mkdtempSync(path.join(os.tmpdir(), "contextpilot-doctor-"));
  try {
    const doctor = runBin(bin, ["--json", "doctor"], {
      cwd: project,
      encoding: "utf8",
    });
    const parsed = JSON.parse(doctor);
    assert.equal(parsed.initialized, false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(prefix, { recursive: true, force: true });
  fs.rmSync(tarball, { force: true });
}
