#!/usr/bin/env node
// efoo-team/skills: MCP サーバー定義同期スクリプト。
// 正本 mcp-servers.json を Claude Code（user スコープ）と opencode（opencode.json）へ配布し、
// Codex（~/.codex/config.toml）は正本バージョンとの一致を検査する（書き換えない。正本は
// codex-code-setting/config.shared.toml）。運用の全体像は MCP-REGISTRY.md を参照。
//
// 設計上の制約:
// - 外部コマンドは execFileSync（配列渡し）のみ。シェル文字列の組み立てを行わない。
// - spec 自体の不正のみ hard fail（exit 1）。環境起因の失敗はすべて warning に落として
//   exit 0 で完走する（setup.sh のスキル配布を巻き込まない。pull ごとの再実行で収束する）。
// - env 変数参照記法 "${env:VAR}"（Claude `${VAR}` / opencode `{env:VAR}` / codex env_vars へ
//   翻訳する構想）は将来用の予約であり、本実装では未対応。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const STATE_PATH = path.join(HOME, '.agents', '.mcp-sync-state.json');

const warnings = [];
const notes = [];
const warn = (msg) => warnings.push(msg);
const note = (msg) => notes.push(msg);

const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: sync-mcp.mjs <mcp-servers.json>');
  process.exit(1);
}

// ---------- helpers ----------

function readJsonOr(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(p, obj) {
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function which(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function run(file, args, opts = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function sameStringArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameEnv(a, b) {
  const na = a && typeof a === 'object' ? a : {};
  const nb = b && typeof b === 'object' ? b : {};
  const ka = Object.keys(na).sort();
  const kb = Object.keys(nb).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && na[k] === nb[k]);
}

// ---------- spec 検証（唯一の hard fail）----------

const spec = readJsonOr(specPath, null);
if (!spec || typeof spec.servers !== 'object') {
  console.error(`sync-mcp: ${specPath} を読めないか形式が不正です`);
  process.exit(1);
}
for (const [name, s] of Object.entries(spec.servers)) {
  if (!s.package || !s.pin || !s.definition) {
    console.error(`sync-mcp: servers.${name} に package / pin / definition が必要です`);
    process.exit(1);
  }
  // half-bump 事故防止: args 内のパッケージ指定と pin の一致検査
  const expected = `${s.package}@${s.pin}`;
  const args = s.definition.args || [];
  if (s.definition.command === 'npx' && !args.includes(expected)) {
    console.error(
      `sync-mcp: servers.${name} の args にパッケージ指定 ${expected} がありません。` +
        ` pin と args のどちらかだけを更新した half-bump の可能性があります`
    );
    process.exit(1);
  }
}

// ---------- Claude Code（user スコープ）----------

function resolveClaude() {
  const found = which('claude');
  if (found) return found;
  const fallback = path.join(HOME, '.local', 'bin', 'claude');
  try {
    fs.accessSync(fallback, fs.constants.X_OK);
    return fallback;
  } catch {
    return null;
  }
}

function claudeEntryMatches(current, def) {
  if (!current) return false;
  if (current.type !== undefined && current.type !== def.type) return false;
  return (
    current.command === def.command &&
    sameStringArray(current.args, def.args) &&
    sameEnv(current.env, def.env)
  );
}

function syncClaude(name, def, claudeBin) {
  const current = readJsonOr(path.join(HOME, '.claude.json'), {}).mcpServers?.[name];
  if (claudeEntryMatches(current, def)) return 'up-to-date';
  try {
    run(claudeBin, ['mcp', 'remove', '-s', 'user', name]);
  } catch {
    // 未登録なら remove は失敗するのが正常系
  }
  run(claudeBin, ['mcp', 'add-json', '-s', 'user', name, JSON.stringify(def)]);
  // 事後検証: 稼働中の Claude Code セッションが ~/.claude.json を書き戻すと追加分が
  // 消えることがある（last-writer-wins）。pull ごとの再実行で収束する。
  const after = readJsonOr(path.join(HOME, '.claude.json'), {}).mcpServers?.[name];
  if (!claudeEntryMatches(after, def)) {
    warn(
      `claude-code: ${name} の登録が確認できません。稼働中の Claude Code セッションが設定を` +
        ` 上書きした可能性があります。セッション終了後に setup.sh を再実行してください`
    );
    return 'unverified';
  }
  return 'updated';
}

function removeClaude(name, claudeBin) {
  const current = readJsonOr(path.join(HOME, '.claude.json'), {}).mcpServers?.[name];
  if (!current) return false;
  try {
    run(claudeBin, ['mcp', 'remove', '-s', 'user', name]);
    return true;
  } catch (e) {
    warn(`claude-code: retired ${name} の削除に失敗しました: ${String(e.stderr || e.message).trim()}`);
    return false;
  }
}

// ---------- opencode（~/.config/opencode/opencode.json）----------

const OPENCODE_CONFIG = path.join(HOME, '.config', 'opencode', 'opencode.json');

function toOpencodeEntry(def) {
  const entry = { type: 'local', command: [def.command, ...(def.args || [])], enabled: true };
  if (def.env && Object.keys(def.env).length > 0) entry.environment = def.env;
  return entry;
}

function opencodeEntryMatches(current, entry) {
  if (!current) return false;
  return (
    current.type === entry.type &&
    sameStringArray(current.command, entry.command) &&
    current.enabled === entry.enabled &&
    sameEnv(current.environment, entry.environment)
  );
}

// 読み込み結果: {cfg} | 'skip'（opencode 未使用）| 'unparsable'
function loadOpencodeConfig() {
  if (!fs.existsSync(OPENCODE_CONFIG)) {
    if (!which('opencode')) return 'skip';
    return { cfg: { $schema: 'https://opencode.ai/config.json', mcp: {} } };
  }
  try {
    return { cfg: JSON.parse(fs.readFileSync(OPENCODE_CONFIG, 'utf8')) };
  } catch {
    // opencode は JSONC を許容する。パース不能＝手動管理ファイルとみなし、絶対に上書きしない。
    return 'unparsable';
  }
}

// ---------- Codex（検査のみ）----------

function verifyCodex(name, s) {
  const tomlPath = path.join(HOME, '.codex', 'config.toml');
  let toml;
  try {
    toml = fs.readFileSync(tomlPath, 'utf8');
  } catch {
    return; // Codex 未使用マシン
  }
  const escaped = s.package.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = toml.match(new RegExp(`${escaped}@([^"'\\s\\]]+)`));
  if (!m) {
    note(`codex: ${name}（${s.package}）の定義が config.toml に見つかりません`);
  } else if (m[1] === 'latest') {
    note(`codex: ${name} は未固定（@latest）です。codex-code-setting/config.shared.toml の固定待ち`);
  } else if (m[1] !== s.pin) {
    warn(
      `codex: ${name} のバージョン ${m[1]} が正本 ${s.pin} と不一致です。` +
        ` codex-code-setting/config.shared.toml を更新し、同リポジトリの setup.sh を実行してください`
    );
  }
}

// ---------- warmup（pin が変わったときだけ実行）----------

function warmup(name, s, state) {
  const st = (state[name] ||= {});
  const pkgSpec = `${s.package}@${s.pin}`;
  if (s.warmup?.npxCache && st.warmedFor !== s.pin) {
    try {
      run('npx', ['-y', '--prefer-offline', pkgSpec, '--version'], { timeout: 120_000 });
      st.warmedFor = s.pin;
    } catch {
      warn(
        `${name}: npx キャッシュ温めに失敗しました（ネットワーク断の可能性。定義の登録自体は完了）。` +
          ` キャッシュ破損が疑われる場合: rm -rf ~/.npm/_npx && npm cache verify の後 setup.sh を再実行`
      );
    }
  }
  if (Array.isArray(s.warmup?.browsers) && s.warmup.browsers.length > 0 && st.browsersFor !== s.pin) {
    try {
      for (const browser of s.warmup.browsers) {
        console.log(`sync-mcp: ${name} のブラウザ（${browser}）を確認・導入しています...`);
        execFileSync('npx', ['-y', '--prefer-offline', pkgSpec, 'install-browser', browser], {
          stdio: 'inherit',
          timeout: 600_000,
        });
      }
      st.browsersFor = s.pin;
    } catch {
      warn(
        `${name}: ブラウザ導入に失敗しました。復旧: npx -y ${pkgSpec} install-browser ${s.warmup.browsers.join(' ')}`
      );
    }
  }
}

// ---------- main ----------

const claudeBin = resolveClaude();
if (!claudeBin) note('claude-code: claude CLI が見つからないためスキップしました');

const opencodeLoad = loadOpencodeConfig();
if (opencodeLoad === 'unparsable') {
  warn(`opencode: ${OPENCODE_CONFIG} を JSON として読めないため変更しません（JSONC・手動管理の可能性）`);
}

const state = readJsonOr(STATE_PATH, {});
const summary = [];

for (const [name, s] of Object.entries(spec.servers)) {
  const results = [];

  if (s.targets?.['claude-code']?.mode === 'sync' && claudeBin) {
    try {
      results.push(`claude:${syncClaude(name, s.definition, claudeBin)}`);
    } catch (e) {
      warn(`claude-code: ${name} の登録に失敗しました: ${String(e.stderr || e.message).trim()}`);
    }
  }

  if (s.targets?.opencode?.mode === 'sync' && typeof opencodeLoad === 'object') {
    const { cfg } = opencodeLoad;
    const entry = toOpencodeEntry(s.definition);
    if (opencodeEntryMatches(cfg.mcp?.[name], entry)) {
      results.push('opencode:up-to-date');
    } else {
      cfg.mcp = { ...(cfg.mcp || {}), [name]: entry };
      try {
        fs.mkdirSync(path.dirname(OPENCODE_CONFIG), { recursive: true });
        atomicWriteJson(OPENCODE_CONFIG, cfg);
        results.push('opencode:updated');
      } catch (e) {
        warn(`opencode: ${OPENCODE_CONFIG} の書き込みに失敗しました: ${e.message}`);
      }
    }
  }

  if (s.targets?.codex?.mode === 'verify') verifyCodex(name, s);

  warmup(name, s, state);
  summary.push(`${name}@${s.pin} [${results.join(' ') || 'no-op'}]`);
}

for (const name of spec.retired || []) {
  let removed = false;
  if (claudeBin) removed = removeClaude(name, claudeBin) || removed;
  if (typeof opencodeLoad === 'object' && opencodeLoad.cfg.mcp?.[name]) {
    delete opencodeLoad.cfg.mcp[name];
    try {
      atomicWriteJson(OPENCODE_CONFIG, opencodeLoad.cfg);
      removed = true;
    } catch (e) {
      warn(`opencode: retired ${name} の削除書き込みに失敗しました: ${e.message}`);
    }
  }
  if (removed) summary.push(`${name} [retired: removed]`);
  delete state[name];
}

try {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  atomicWriteJson(STATE_PATH, state);
} catch (e) {
  warn(`state ファイル ${STATE_PATH} の書き込みに失敗しました: ${e.message}`);
}

console.log(`sync-mcp: ${summary.join(', ')}`);
for (const msg of notes) console.log(`sync-mcp: [info] ${msg}`);
for (const msg of warnings) console.error(`sync-mcp: [warning] ${msg}`);
