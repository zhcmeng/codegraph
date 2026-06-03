/**
 * Trae IDE target.
 *
 * Trae is ByteDance's free AI IDE (VS Code fork). MCP support was
 * introduced in v1.3.0. Writes:
 *
 *   - MCP server entry to `~/.trae/mcp.json` (global) or
 *     `./.trae/mcp.json` (local). Standard `mcpServers.codegraph` shape.
 *
 * ## Why we inject `--path`
 *
 * Trae is a VS Code fork — same lineage as Cursor — so it may launch
 * MCP subprocesses with a working directory that isn't the workspace
 * root. Without `--path` the codegraph MCP server's `process.cwd()`
 * fallback misses `.codegraph/` and reports "not initialized".
 * Injecting `--path` is a defensive safety net: harmless when cwd is
 * correct, load-bearing when it isn't. Pending real-world verification.
 *
 * ## No `type` field
 *
 * Trae auto-detects the transport from the config shape:
 * `command` → stdio, `url` → SSE/HTTP. The official documentation omits
 * `type` from all stdio examples, so we omit it too.
 *
 * ## No `autoApprove` (v1)
 *
 * Community sources show an `autoApprove` field, but the official docs
 * do not document it. v1 omits it to avoid a non-standard field causing
 * parse failures. Can be wired to `--auto-allow` in a follow-up once
 * confirmed to work.
 *
 * ## Project-level MCP
 *
 * Trae requires users to enable "Project-level MCP" in
 * Settings > MCP before it loads `./.trae/mcp.json`. The install notes
 * surface this.
 *
 * ## No permissions, no instructions files, no legacy migration
 *
 * Trae has no `settings.json`-style permissions allowlist, no
 * AGENTS.md / CLAUDE.md / rules concept, and this is a new target
 * with no historical baggage to clean up. The install function writes
 * exactly one file.
 *
 * Docs: https://docs.trae.ai/ide/model-context-protocol
 *       https://www.volcengine.com/docs/86677/2137601
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  jsonDeepEqual,
  readJsonFile,
  writeJsonFile,
} from './shared';

function configDir(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.trae')
    : path.join(process.cwd(), '.trae');
}

function mcpJsonPath(loc: Location): string {
  return path.join(configDir(loc), 'mcp.json');
}

/**
 * Build the codegraph MCP-server entry for Trae at the given location.
 *
 * Mirrors Cursor's `buildCursorMcpConfig`:
 *   - Omits `type` (Trae auto-detects from `command` vs `url`).
 *   - Appends `--path` so the server resolves the workspace root
 *     regardless of Trae's launch cwd.
 */
function buildTraeMcpEntry(loc: Location): { command: string; args: string[] } {
  const pathArg = loc === 'local' ? process.cwd() : '${workspaceFolder}';
  return {
    command: 'codegraph',
    args: ['serve', '--mcp', '--path', pathArg],
  };
}

class TraeTarget implements AgentTarget {
  readonly id = 'trae' as const;
  readonly displayName = 'Trae';
  readonly docsUrl = 'https://docs.trae.ai/ide/model-context-protocol';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(loc: Location): DetectionResult {
    const mcpPath = mcpJsonPath(loc);
    const config = readJsonFile(mcpPath);
    const alreadyConfigured = !!config.mcpServers?.codegraph;
    const installed = loc === 'global'
      ? fs.existsSync(configDir(loc)) || fs.existsSync(mcpPath)
      : fs.existsSync(configDir(loc));
    return { installed, alreadyConfigured, configPath: mcpPath };
  }

  install(loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const notes: string[] = [];

    files.push(writeMcpEntry(loc));

    if (loc === 'local') {
      notes.push(
        'Enable "Project-level MCP" in Trae Settings > MCP to load this config.',
      );
    }
    notes.push('Restart Trae for MCP changes to take effect.');

    return { files, notes };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    const file = mcpJsonPath(loc);

    if (!fs.existsSync(file)) {
      files.push({ path: file, action: 'not-found' });
      return { files };
    }

    const config = readJsonFile(file);
    if (!config.mcpServers?.codegraph) {
      files.push({ path: file, action: 'not-found' });
      return { files };
    }

    delete config.mcpServers.codegraph;
    if (Object.keys(config.mcpServers).length === 0) {
      delete config.mcpServers;
    }
    writeJsonFile(file, config);
    files.push({ path: file, action: 'removed' });

    return { files };
  }

  printConfig(loc: Location): string {
    const target = mcpJsonPath(loc);
    const snippet = JSON.stringify(
      { mcpServers: { codegraph: buildTraeMcpEntry(loc) } },
      null,
      2,
    );
    return `# Add to ${target}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [mcpJsonPath(loc)];
  }
}

function writeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = mcpJsonPath(loc);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existing = readJsonFile(file);
  const before = existing.mcpServers?.codegraph;
  const after = buildTraeMcpEntry(loc);

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }

  const existed = fs.existsSync(file);
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.codegraph = after;
  writeJsonFile(file, existing);
  return { path: file, action: existed ? 'updated' : 'created' };
}

export const traeTarget: AgentTarget = new TraeTarget();
