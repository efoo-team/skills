import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const setupPath = fileURLToPath(new URL('../setup.sh', import.meta.url));
const removeSkillsPath = fileURLToPath(new URL('../remove-skills.txt', import.meta.url));
const repositoryRemoveSkills = readFileSync(removeSkillsPath, 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));
const fixtureRemoveSkills = [...repositoryRemoveSkills, 'blocked-one', 'blocked-two'];
const expectedAgents = `aider-desk amp antigravity antigravity-cli astrbot autohand-code augment bob
claude-code openclaw cline codearts-agent codebuddy codemaker codestudio codex
command-code continue cortex crush cursor deepagents devin dexto droid firebender
forgecode gemini-cli github-copilot goose hermes-agent inference-sh jazz junie
iflow-cli kilo kimi-code-cli kiro-cli kode lingma loaf mcpjam mistral-vibe moxby mux
opencode openhands ona pi qoder qoder-cn qwen-code replit reasonix rovodev roo
tabnine-cli terramind tinycloud trae trae-cn warp windsurf zed zencoder zenflow
neovate pochi adal universal`.split(/\s+/).sort();

// PATH that contains the commands setup.sh needs but no gh, wherever the real gh is installed.
function pathWithoutGh(fixture, bin) {
  const tools = join(fixture, 'tools');
  mkdirSync(tools);
  for (const tool of ['awk', 'bash', 'cp', 'dirname', 'mktemp', 'rm', 'tee']) {
    const found = process.env.PATH.split(':').map(dir => join(dir, tool)).find(candidate => existsSync(candidate));
    symlinkSync(found, join(tools, tool));
  }
  return `${bin}:${tools}`;
}

function runSetup(t, options = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'skills-setup-test-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const bin = join(fixture, 'bin');
  const temporary = join(fixture, 'tmp');
  const callsPath = join(fixture, 'calls');
  mkdirSync(bin);
  mkdirSync(temporary);
  mkdirSync(join(fixture, 'hooks'));
  writeFileSync(callsPath, '');
  let setupContents = readFileSync(setupPath, 'utf8');
  if (options.legacyFormationAdd) {
    const externalSkillsAnchor = '# External skills\n';
    assert.ok(setupContents.includes(externalSkillsAnchor));
    setupContents = setupContents.replace(
      externalSkillsAnchor,
      `INSTALL_INTERNAL_SKILLS=1 run_skills add efoo-team/skills --skill formation-designer -g -a opencode -y\n\n${externalSkillsAnchor}`,
    );
  }
  writeFileSync(join(fixture, 'setup.sh'), setupContents);
  writeFileSync(join(fixture, 'remove-skills.txt'), `${readFileSync(removeSkillsPath, 'utf8')}\n blocked-one \n\nblocked-two\n`);
  writeFileSync(join(fixture, 'sync-mcp.sh'), 'printf "mcp\\n" >> "$TEST_CALLS"\nexit "${MCP_STATUS:-0}"\n');
  const command = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  command('node', `echo ${options.nodeVersion ?? 'v24.0.0'}`);
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
  if (!options.noGh) {
    command('gh', `
printf 'gh\\t' >> "$TEST_CALLS"
printf '%s\\t' "$@" >> "$TEST_CALLS"
printf '\\n' >> "$TEST_CALLS"
if [ "$2" = "\${GH_FAIL_AT:-none}" ]; then
  echo "gh: $2 failed" >&2
  exit 1
fi
if [ "$2" = list ]; then
  printf 'gh image\\tdrogers0/gh-image\\tv1.2.0\\n'
  printf 'gh pr-review-check-extra\\tother/gh-pr-review-check-extra\\t1a2b3c4d\\n'
  printf 'gh pr-review-check-local\\t\\t\\n'
  if [ "\${GH_EXTENSION_INSTALLED:-0}" = 1 ]; then
    printf 'gh pr-review-check\\tabekdwight/gh-pr-review-check\\t72c4acec\\n'
  elif [ "\${GH_EXTENSION_LOCAL:-0}" = 1 ]; then
    printf 'gh pr-review-check\\t\\t\\n'
  fi
fi`);
  }
  if (options.teeFailure) command('tee', 'cat > "$1"\nexit 11');
  const result = spawnSync('/bin/bash', [join(fixture, 'setup.sh')], {
    cwd: fixture,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: options.noGh ? pathWithoutGh(fixture, bin) : `${bin}:${process.env.PATH}`,
      TMPDIR: temporary,
      TEST_FIXTURE: fixture,
      TEST_CALLS: callsPath,
      FAIL_AT: options.failAt ?? '',
      FAIL_KIND: options.failKind ?? '',
      REMOVE_NO_MATCH: options.noMatch ? '1' : '0',
      REMOTE_SETUP: options.remote ? '1' : '0',
      MCP_STATUS: options.mcpFailure ? '9' : '0',
      GH_FAIL_AT: options.ghFailAt ?? '',
      GH_EXTENSION_INSTALLED: options.ghInstalled ? '1' : '0',
      GH_EXTENSION_LOCAL: options.ghLocal ? '1' : '0',
    },
  });
  assert.ifError(result.error);
  const callsText = readFileSync(callsPath, 'utf8').trim();
  const calls = callsText ? callsText.split('\n').map(line => line.split('\t').filter(Boolean)) : [];
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

function assertNoFormationDesignerAdd(result) {
  const addCalls = npxCalls(result).filter(call => call[3] === 'add' && call.includes('formation-designer'));
  assert.equal(addCalls.length, 0, 'setup still installs formation-designer');
}

function ghCalls(result) {
  return result.calls.filter(call => call[0] === 'gh').map(call => call.slice(1));
}

test('Node.js 24 setup preserves all 70 global targets and retires formation-designer', t => {
  const result = runSetup(t, { nodeVersion: 'v24.0.0' });
  assert.equal(result.status, 0);
  const calls = npxCalls(result);
  assert.deepEqual(calls.map(call => call[3]), ['add', 'add', 'remove', 'list']);
  assert.equal(calls[0][4], 'efoo-team/skills');
  assert.equal(calls[1][4], 'abekdwight/code-debug-skills');
  assert.deepEqual(calls[1].slice(5, 7), ['--skill', 'code-debug-skill']);
  for (const call of [calls[0], calls[1]]) {
    assert.equal(call[2], 'skills@1.5.14');
    assert.ok(call.includes('-g'));
    assert.ok(call.includes('-y'));
    const agents = call.slice(call.indexOf('-a') + 1, call.indexOf('-y')).sort();
    assert.equal(agents.length, 70);
    assert.deepEqual(agents, expectedAgents);
    assert.ok(!agents.includes('eve') && !agents.includes('promptscript'));
  }
  assertNoFormationDesignerAdd(result);
  assert.ok(repositoryRemoveSkills.includes('formation-designer'));
  assert.deepEqual(calls[2], ['npx', '0', 'skills@1.5.14', 'remove', ...fixtureRemoveSkills, '-g', '-y']);
  assert.deepEqual(calls[3], ['npx', '0', 'skills@1.5.14', 'list', '-g']);
  assert.deepEqual(result.calls.slice(-5).map(call => call[0]), ['hook', 'mcp', 'gh', 'gh', 'npx']);
  const listPosition = result.stdout.indexOf('completed list');
  const donePosition = result.stdout.indexOf('=== Done ===');
  assert.ok(listPosition >= 0);
  assert.ok(donePosition >= 0);
  assert.ok(listPosition < donePosition);
});

test('formation-designer legacy add fixture is detected', t => {
  const result = runSetup(t, { legacyFormationAdd: true });
  assert.equal(result.status, 0);
  const oldAddCalls = npxCalls(result).filter(call => call[3] === 'add' && call.includes('formation-designer'));
  assert.equal(oldAddCalls.length, 1);
  assert.throws(() => assertNoFormationDesignerAdd(result), /setup still installs formation-designer/);
});

test('Node.js 23 is rejected before setup changes', t => {
  const result = runSetup(t, { nodeVersion: 'v23.0.0' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Node >= 24/);
  assert.match(result.stderr, /nodebrew install-binary v24/);
  assert.deepEqual(result.calls, []);
  assert.ok(!result.stdout.includes('=== Done ==='));
});

for (const [failAt, failKind, count] of [
  ['team', 'stdout', 1],
  ['team', 'stderr', 1],
  ['team', 'ansi-stdout', 1],
  ['team', 'ansi-stderr', 1],
  ['external', 'stderr', 2],
  ['remove', 'stdout', 3],
  ['remove', 'ansi-stderr', 3],
  ['team', 'exit', 1],
  ['remove', 'exit', 3],
]) {
  const name = failAt === 'remove'
    ? `remove failure (${failKind}) stops setup`
    : `${failAt} ${failKind} failure stops setup`;
  test(name, t => {
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
  assert.equal(npxCalls(result).length, 4);
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
  assert.equal(ghCalls(result).length, 2);
  assert.match(result.stdout, /=== Done ===/);
});

const ghExtensionRepo = 'abekdwight/gh-pr-review-check';
const ghExtensionList = ['extension', 'list'];
const ghExtensionInstall = ['extension', 'install', ghExtensionRepo];
const ghExtensionUpgrade = ['extension', 'upgrade', 'gh-pr-review-check'];

test('gh extension is installed when no extension of that name exists', t => {
  const result = runSetup(t);
  assert.equal(result.status, 0);
  assert.deepEqual(ghCalls(result), [ghExtensionList, ghExtensionInstall]);
  assert.match(result.stdout, /=== Installing gh extension: abekdwight\/gh-pr-review-check ===/);
  assert.match(result.stdout, /=== Done ===/);
});

test('installed gh extension is upgraded by name and other extensions are left alone', t => {
  const result = runSetup(t, { ghInstalled: true });
  assert.equal(result.status, 0);
  assert.deepEqual(ghCalls(result), [ghExtensionList, ghExtensionUpgrade]);
  assert.match(result.stdout, /=== Updating gh extension: gh-pr-review-check ===/);
  assert.match(result.stdout, /=== Done ===/);
});

test('gh extension installed from a local folder is not upgraded and is not a warning', t => {
  const result = runSetup(t, { ghLocal: true });
  assert.equal(result.status, 0);
  assert.deepEqual(ghCalls(result), [ghExtensionList]);
  assert.match(result.stdout, /=== Skipping gh extension update: gh-pr-review-check is installed from a local folder ===/);
  assert.doesNotMatch(result.stderr, /Warning/);
  assert.equal(npxCalls(result).at(-1)[3], 'list');
  assert.match(result.stdout, /=== Done ===/);
});

test('missing gh skips the extension with guidance', t => {
  const result = runSetup(t, { noGh: true });
  assert.equal(result.status, 0);
  assert.deepEqual(ghCalls(result), []);
  assert.match(result.stderr, /Warning: gh is not available; skipping gh extension abekdwight\/gh-pr-review-check/);
  assert.match(result.stderr, /https:\/\/cli\.github\.com\//);
  assert.equal(npxCalls(result).at(-1)[3], 'list');
  assert.match(result.stdout, /=== Done ===/);
});

for (const [ghFailAt, ghInstalled, expectedCalls] of [
  ['list', false, [ghExtensionList]],
  ['install', false, [ghExtensionList, ghExtensionInstall]],
  ['upgrade', true, [ghExtensionList, ghExtensionUpgrade]],
]) {
  test(`gh extension ${ghFailAt} failure only warns`, t => {
    const result = runSetup(t, { ghFailAt, ghInstalled });
    assert.equal(result.status, 0);
    assert.deepEqual(ghCalls(result), expectedCalls);
    assert.match(result.stderr, /Warning: gh extension sync failed/);
    assert.equal(npxCalls(result).at(-1)[3], 'list');
    assert.match(result.stdout, /=== Done ===/);
  });
}
