import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const setupPath = fileURLToPath(new URL('../setup.sh', import.meta.url));
const expectedAgents = `aider-desk amp antigravity antigravity-cli astrbot autohand-code augment bob
claude-code openclaw cline codearts-agent codebuddy codemaker codestudio codex
command-code continue cortex crush cursor deepagents devin dexto droid firebender
forgecode gemini-cli github-copilot goose hermes-agent inference-sh jazz junie
iflow-cli kilo kimi-code-cli kiro-cli kode lingma loaf mcpjam mistral-vibe moxby mux
opencode openhands ona pi qoder qoder-cn qwen-code replit reasonix rovodev roo
tabnine-cli terramind tinycloud trae trae-cn warp windsurf zed zencoder zenflow
neovate pochi adal universal`.split(/\s+/).sort();

function runSetup(t, options = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'skills-setup-test-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const bin = join(fixture, 'bin');
  const temporary = join(fixture, 'tmp');
  const callsPath = join(fixture, 'calls');
  mkdirSync(bin);
  mkdirSync(temporary);
  mkdirSync(join(fixture, 'hooks'));
  copyFileSync(setupPath, join(fixture, 'setup.sh'));
  writeFileSync(join(fixture, 'remove-skills.txt'), '# blocked skills\n blocked-one \n\nblocked-two\n');
  writeFileSync(join(fixture, 'sync-mcp.sh'), 'printf "mcp\\n" >> "$TEST_CALLS"\nexit "${MCP_STATUS:-0}"\n');
  const command = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  command('node', 'echo v22.0.0');
  command('git', `
if [ "$3" = rev-parse ]; then
  if [ "\${REMOTE_SETUP:-0}" = 1 ]; then exit 1; fi
  printf '%s\\n' "$TEST_FIXTURE"
else
  printf 'hook\\n' >> "$TEST_CALLS"
fi`);
  command('curl', `
printf 'fetch\\t%s\\n' "$2" >> "$TEST_CALLS"
case "$2" in
  */remove-skills.txt) cp "$TEST_FIXTURE/remove-skills.txt" "$4" ;;
  */sync-mcp.sh) cp "$TEST_FIXTURE/sync-mcp.sh" "$4" ;;
  *) exit 99 ;;
esac`);
  command('npx', `
printf 'npx\\t%s\\t' "\${INSTALL_INTERNAL_SKILLS:-0}" >> "$TEST_CALLS"
printf '%s\\t' "$@" >> "$TEST_CALLS"
printf '\\n' >> "$TEST_CALLS"
stage="$2"
if [ "$stage" = add ]; then
  stage=team
  case "$*" in
    *formation-designer*) stage=specific ;;
    *code-debug-skill*) stage=external ;;
  esac
fi
if [ "$stage" = "\${FAIL_AT:-}" ]; then
  operation=install
  if [ "$stage" = remove ]; then operation=remove; fi
  case "$FAIL_KIND" in
    stdout) printf 'Failed to %s 2 skill(s)\\n' "$operation" ;;
    stderr) printf 'Failed to %s 2 skill(s)\\n' "$operation" >&2 ;;
    ansi-stdout) printf '\\033[31mFailed to %s \\033[1m2\\033[0m skill(s)\\n' "$operation" ;;
    ansi-stderr) printf '\\033[31mFailed to %s \\033[1m2\\033[0m skill(s)\\n' "$operation" >&2 ;;
    exit) echo 'CLI failure' >&2; exit 23 ;;
  esac
elif [ "$stage" = remove ] && [ "\${REMOVE_NO_MATCH:-0}" = 1 ]; then
  echo 'No matching skills found'
else
  echo "completed $stage"
  echo 'Failed to install 0 skill(s)'
  echo 'Risk: High; scanner failed to analyze skill'
fi`);
  if (options.teeFailure) command('tee', 'cat > "$1"\nexit 11');
  const result = spawnSync('/bin/bash', [join(fixture, 'setup.sh')], {
    cwd: fixture,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: temporary,
      TEST_FIXTURE: fixture,
      TEST_CALLS: callsPath,
      FAIL_AT: options.failAt ?? '',
      FAIL_KIND: options.failKind ?? '',
      REMOVE_NO_MATCH: options.noMatch ? '1' : '0',
      REMOTE_SETUP: options.remote ? '1' : '0',
      MCP_STATUS: options.mcpFailure ? '9' : '0',
    },
  });
  assert.ifError(result.error);
  const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(line => line.split('\t').filter(Boolean));
  const observable = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls,
    temporaryFiles: readdirSync(temporary),
  };
  if (process.env.SETUP_TEST_EVIDENCE_DIR) {
    const evidence = resolve(process.env.SETUP_TEST_EVIDENCE_DIR);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, `${t.name.replace(/[^a-z0-9-]/gi, '-')}.json`), `${JSON.stringify(observable, null, 2)}\n`);
  }
  assert.deepEqual(observable.temporaryFiles, [], 'EXIT cleanup removes captured and downloaded files');
  return observable;
}

function npxCalls(result) {
  return result.calls.filter(call => call[0] === 'npx');
}

test('successful setup preserves all 70 global targets and agent-specific installation', t => {
  const result = runSetup(t);
  assert.equal(result.status, 0);
  const calls = npxCalls(result);
  assert.deepEqual(calls.map(call => call[3]), ['add', 'add', 'add', 'remove', 'list']);
  for (const call of [calls[0], calls[2]]) {
    assert.equal(call[2], 'skills@1.5.14');
    assert.ok(call.includes('-g'));
    assert.ok(call.includes('-y'));
    const agents = call.slice(call.indexOf('-a') + 1, call.indexOf('-y')).sort();
    assert.equal(agents.length, 70);
    assert.deepEqual(agents, expectedAgents);
    assert.ok(!agents.includes('eve') && !agents.includes('promptscript'));
  }
  assert.deepEqual(calls[1], ['npx', '1', 'skills@1.5.14', 'add', 'efoo-team/skills', '--skill', 'formation-designer', '-g', '-a', 'opencode', '-y']);
  assert.deepEqual(calls[3], ['npx', '0', 'skills@1.5.14', 'remove', 'blocked-one', 'blocked-two', '-g', '-y']);
  assert.deepEqual(calls[4], ['npx', '0', 'skills@1.5.14', 'list', '-g']);
  assert.deepEqual(result.calls.slice(-3).map(call => call[0]), ['hook', 'mcp', 'npx']);
  const listPosition = result.stdout.indexOf('completed list');
  const donePosition = result.stdout.indexOf('=== Done ===');
  assert.ok(listPosition >= 0);
  assert.ok(donePosition >= 0);
  assert.ok(listPosition < donePosition);
});

for (const [failAt, failKind, count] of [
  ['team', 'stdout', 1],
  ['team', 'stderr', 1],
  ['team', 'ansi-stdout', 1],
  ['team', 'ansi-stderr', 1],
  ['specific', 'stdout', 2],
  ['external', 'stderr', 3],
  ['remove', 'stdout', 4],
  ['remove', 'ansi-stderr', 4],
  ['team', 'exit', 1],
  ['remove', 'exit', 4],
]) {
  test(`${failAt} ${failKind} failure stops setup`, t => {
    const result = runSetup(t, { failAt, failKind });
    assert.equal(result.status, failKind === 'exit' ? 23 : 1);
    assert.equal(npxCalls(result).length, count);
    assert.ok(result.calls.every(call => call[0] === 'npx'));
    assert.ok(!result.stdout.includes('=== Done ==='));
    if (failKind !== 'exit') assert.match(result.stdout, /Failed to/);
  });
}

test('tee failure stops setup with its original status', t => {
  const result = runSetup(t, { teeFailure: true });
  assert.equal(result.status, 11);
  assert.equal(npxCalls(result).length, 1);
  assert.ok(!result.stdout.includes('=== Done ==='));
});

test('list failure prevents Done', t => {
  const result = runSetup(t, { failAt: 'list', failKind: 'exit' });
  assert.equal(result.status, 23);
  assert.equal(npxCalls(result).length, 5);
  assert.ok(!result.stdout.includes('=== Done ==='));
});

test('no matching blocked skills remains successful', t => {
  const result = runSetup(t, { noMatch: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No matching skills found/);
  assert.match(result.stdout, /=== Done ===/);
});

test('remote setup still fetches removal policy and MCP script', t => {
  const result = runSetup(t, { remote: true });
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls.filter(call => call[0] === 'fetch').map(call => call[1]), [
    'https://raw.githubusercontent.com/efoo-team/skills/main/remove-skills.txt',
    'https://raw.githubusercontent.com/efoo-team/skills/main/sync-mcp.sh',
  ]);
  assert.ok(!result.calls.some(call => call[0] === 'hook'));
  assert.match(result.stdout, /=== Done ===/);
});

test('MCP failure preserves warning and completion policy', t => {
  const result = runSetup(t, { mcpFailure: true });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Warning: MCP sync failed/);
  assert.match(result.stdout, /=== Done ===/);
});
