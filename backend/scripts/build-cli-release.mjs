#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(
  process.env.AGENTROOM_CLI_OUTPUT_DIR ??
    resolve(backendRoot, "artifacts", "cli"),
);
if (
  basename(outputDirectory) !== "cli" ||
  outputDirectory === parse(outputDirectory).root ||
  outputDirectory === backendRoot ||
  outputDirectory === dirname(backendRoot)
) {
  throw new Error("AgentRoom CLI output directory must be a dedicated cli directory");
}
const packageJson = JSON.parse(
  await readFile(resolve(backendRoot, "package.json"), "utf8"),
);
const version = requiredVersion(packageJson.version);
const downloadBase = normalizeDownloadBase(
  process.env.AGENTROOM_CLI_DOWNLOAD_BASE ??
    "http://127.0.0.1:8787/downloads/cli",
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true, mode: 0o755 });

const temporaryBundlePath = resolve(outputDirectory, "agentroom.mjs.tmp");
await build({
  entryPoints: [resolve(backendRoot, "src", "connectors", "cli.ts")],
  outfile: temporaryBundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The CLI is ESM, while ws and some of its transitive dependencies are
  // CommonJS and dynamically require Node built-ins such as events/stream.
  // Give esbuild's CommonJS compatibility helper a real Node require instead
  // of its browser-style "dynamic require is not supported" fallback.
  banner: {
    js: 'import { createRequire as __agentroomCreateRequire } from "node:module";\nconst require = __agentroomCreateRequire(import.meta.url);',
  },
  // @napi-rs/keyring is an optional native enhancement. A single portable
  // JavaScript release cannot embed every OS/architecture .node binary, and
  // the connector already falls back to its mode-0600 config when this import
  // is unavailable. Keep the dynamic import intact instead of making esbuild
  // consume the build host's native binary.
  external: ["@napi-rs/keyring"],
  legalComments: "none",
  sourcemap: false,
  minify: false,
  define: {
    __AGENTROOM_CLI_VERSION__: JSON.stringify(version),
    __AGENTROOM_CLI_DOWNLOAD_BASE__: JSON.stringify(downloadBase),
  },
});
const temporaryBundle = await artifact(temporaryBundlePath);
const bundleName =
  `agentroom-v${version}-${temporaryBundle.sha256.slice(0, 12)}.mjs`;
const bundlePath = resolve(outputDirectory, bundleName);
await rename(temporaryBundlePath, bundlePath);
await chmod(bundlePath, 0o755);

const bundle = temporaryBundle;
const unixInstallerPath = resolve(outputDirectory, "install.sh");
const windowsInstallerPath = resolve(outputDirectory, "install.ps1");
await writeFile(
  unixInstallerPath,
  unixInstaller({ bundleName, bundleSha256: bundle.sha256, downloadBase }),
  { encoding: "utf8", mode: 0o755 },
);
await writeFile(
  windowsInstallerPath,
  windowsInstaller({ bundleName, bundleSha256: bundle.sha256, downloadBase }),
  { encoding: "utf8", mode: 0o644 },
);

const unix = await artifact(unixInstallerPath);
const windows = await artifact(windowsInstallerPath);
const manifest = {
  schemaVersion: 1,
  version,
  minimumNodeVersion: "22.0.0",
  providers: ["claude", "codex"],
  files: {
    bundle: {
      name: bundleName,
      mediaType: "text/javascript",
      ...bundle,
    },
    macosLinuxInstaller: {
      name: "install.sh",
      mediaType: "text/x-shellscript",
      ...unix,
    },
    windowsInstaller: {
      name: "install.ps1",
      mediaType: "text/plain",
      ...windows,
    },
  },
};
await writeFile(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o644 },
);

console.log(
  `Built AgentRoom CLI ${version} for macOS/Linux and Windows in ${outputDirectory}`,
);

async function artifact(path) {
  const content = await readFile(path);
  const metadata = await stat(path);
  return {
    sha256: createHash("sha256").update(content).digest("hex"),
    size: metadata.size,
  };
}

function requiredVersion(value) {
  if (
    typeof value !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  ) {
    throw new Error("package.json version must be a safe semantic version");
  }
  return value;
}

function normalizeDownloadBase(value) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "AGENTROOM_CLI_DOWNLOAD_BASE must be an HTTP(S) URL without credentials, query, or hash",
    );
  }
  const normalized = url.toString().replace(/\/$/, "");
  if (!/^https?:\/\/[A-Za-z0-9._~:/%\[\]-]+$/.test(normalized)) {
    throw new Error("AGENTROOM_CLI_DOWNLOAD_BASE contains unsafe characters");
  }
  return normalized;
}

function unixInstaller({ bundleName, bundleSha256, downloadBase }) {
  return `#!/bin/sh
set -eu

DOWNLOAD_BASE=\${AGENTROOM_DOWNLOAD_BASE:-${shellQuote(downloadBase)}}
BIN_DIR=\${AGENTROOM_BIN_DIR:-"\$HOME/.local/bin"}
BUNDLE_NAME=${shellQuote(bundleName)}
EXPECTED_SHA256=${shellQuote(bundleSha256)}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "\$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "\$TMP_DIR"' EXIT HUP INT TERM
BUNDLE_PATH="\$TMP_DIR/agentroom.mjs"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --retry 3 "\$DOWNLOAD_BASE/\$BUNDLE_NAME" -o "\$BUNDLE_PATH"
elif command -v wget >/dev/null 2>&1; then
  wget -q "\$DOWNLOAD_BASE/\$BUNDLE_NAME" -O "\$BUNDLE_PATH"
else
  echo "curl or wget is required to download AgentRoom CLI." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256=$(sha256sum "\$BUNDLE_PATH" | awk '{print \$1}')
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256=$(shasum -a 256 "\$BUNDLE_PATH" | awk '{print \$1}')
else
  echo "sha256sum or shasum is required to verify AgentRoom CLI." >&2
  exit 1
fi
if [ "\$ACTUAL_SHA256" != "\$EXPECTED_SHA256" ]; then
  echo "AgentRoom CLI checksum verification failed." >&2
  exit 1
fi

mkdir -p "\$BIN_DIR"
install -m 0644 "\$BUNDLE_PATH" "\$BIN_DIR/agentroom.mjs"
cat >"\$TMP_DIR/agentroom" <<'AGENTROOM_WRAPPER'
#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "\$0")" && pwd)
export AGENTROOM_CLI_ENTRY="\$SCRIPT_DIR/agentroom.mjs"
exec node "\$AGENTROOM_CLI_ENTRY" "\$@"
AGENTROOM_WRAPPER
install -m 0755 "\$TMP_DIR/agentroom" "\$BIN_DIR/agentroom"
"\$BIN_DIR/agentroom" --help >/dev/null

echo "AgentRoom CLI installed to \$BIN_DIR/agentroom"
echo "Claude and Codex running as this OS user share this installation."
echo "Update it later with: agentroom update"
case ":\$PATH:" in
  *":\$BIN_DIR:"*) ;;
  *)
    echo "Add it to PATH for this shell before running agentroom:"
    printf '  export PATH="%s:$PATH"\n' "\$BIN_DIR"
    ;;
esac
`;
}

function windowsInstaller({ bundleName, bundleSha256, downloadBase }) {
  return `$ErrorActionPreference = "Stop"

$DownloadBase = if ($env:AGENTROOM_DOWNLOAD_BASE) { $env:AGENTROOM_DOWNLOAD_BASE.TrimEnd("/") } else { ${powerShellQuote(downloadBase)} }
$BinDir = if ($env:AGENTROOM_BIN_DIR) { $env:AGENTROOM_BIN_DIR } else { Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "AgentRoom\\bin" }
$BundleName = ${powerShellQuote(bundleName)}
$ExpectedSha256 = ${powerShellQuote(bundleSha256)}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required."
}
$NodeMajor = [int](& node -p 'Number(process.versions.node.split(".")[0])')
if ($NodeMajor -lt 22) {
  throw "Node.js 22 or newer is required; found $(& node --version)."
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$TemporaryBundle = Join-Path $BinDir "agentroom.mjs.download"
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$DownloadBase/$BundleName" -OutFile $TemporaryBundle
  $ActualSha256 = (Get-FileHash -Algorithm SHA256 $TemporaryBundle).Hash.ToLowerInvariant()
  if ($ActualSha256 -ne $ExpectedSha256) {
    throw "AgentRoom CLI checksum verification failed."
  }
  Move-Item -Force $TemporaryBundle (Join-Path $BinDir "agentroom.mjs")
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $TemporaryBundle
}

$Launcher = @'
@echo off
setlocal
set "AGENTROOM_CLI_ENTRY=%~dp0agentroom.mjs"
node "%AGENTROOM_CLI_ENTRY%" %*
'@
Set-Content -Encoding ASCII -Path (Join-Path $BinDir "agentroom.cmd") -Value $Launcher

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$PathEntries = @(($UserPath -split ";") | Where-Object { $_ })
if ($PathEntries -notcontains $BinDir) {
  $NextPath = (@($PathEntries) + $BinDir) -join ";"
  [Environment]::SetEnvironmentVariable("Path", $NextPath, "User")
}
$env:Path = "$BinDir;$env:Path"
& (Join-Path $BinDir "agentroom.cmd") --help | Out-Null
Write-Host "AgentRoom CLI installed to $BinDir\\agentroom.cmd"
Write-Host "Claude and Codex running as this Windows user share this installation."
Write-Host "Update it later with: agentroom update"
Write-Host "Open a new terminal, then run: agentroom --help"
`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powerShellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
