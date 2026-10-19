import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./sync-mcp.mjs', import.meta.url));
const canonicalPath = fileURLToPath(new URL('../mcp-servers.json', import.meta.url));
const evidence = [];

after(() => {
  const evidenceDirectory = process.env.MCP_SYNC_TEST_EVIDENCE_DIR;
  if (!evidenceDirectory) return;
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, 'sync-mcp.json'), `${JSON.stringify(evidence, null, 2)}\n`);
});

function xmlUnescape(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function plistSection(plist, name, tag) {
  const match = plist.match(new RegExp(`<key>${name}<\\/key>\\s*<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  assert.ok(match, `plist has ${name}`);
  return match[1];
}

function readProgramArguments(plist) {
  const section = plistSection(plist, 'ProgramArguments', 'array');
  return [...section.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => xmlUnescape(match[1]));
}

function readEnvironment(plist) {
  const section = plistSection(plist, 'EnvironmentVariables', 'dict');
  const entries = [...section.matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)];
  return Object.fromEntries(entries.map((match) => [xmlUnescape(match[1]), xmlUnescape(match[2])]));
}

function getDaemonPlist(home, label) {
  const plistPath = join(home, 'Library', 'LaunchAgents', `${label}.plist`);
  return { plistPath, plist: readFileSync(plistPath, 'utf8') };
}

function makeFixture(t, environmentContent) {
  const root = mkdtempSync(join(tmpdir(), 'sync-mcp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const configDirectory = join(home, '.config', 'opencode');
  const environmentDirectory = join(home, '.config', 'efoo-team', 'mcp');
  const launchctlLog = join(root, 'launchctl.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(configDirectory, { recursive: true });
  mkdirSync(environmentDirectory, { recursive: true });

  const launchctlPath = join(bin, 'launchctl');
  writeFileSync(launchctlPath, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$TEST_LAUNCHCTL_LOG"\nexit 0\n');
  chmodSync(launchctlPath, 0o755);

  const allowNames = [
    'list_projects',
    'get_project',
    'list_issues',
    'get_issue',
    'create_issue',
    'update_issue',
    'add_comment',
    'list_comments',
    'search_issues',
    'list_users',
    'get_user',
    'list_categories',
    'list_versions',
    'list_milestones',
    'list_priorities',
    'list_statuses',
    'list_issue_types',
    'list_wikis',
    'get_wiki',
  ];
  const backlogAllowMap = Object.fromEntries(allowNames.map((name) => [`backlog-server.${name}`, true]));
  const backlogEntry = {
    type: 'local',
    command: ['npx', '-y', 'backlog-mcp-server@1.0.0'],
    enabled: true,
    allowedTools: allowNames.map((name) => `backlog-server.${name}`),
  };
  const opencodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    tools: backlogAllowMap,
    mcp: { 'backlog-server': backlogEntry },
  };
  const opencodePath = join(configDirectory, 'opencode.json');
  writeFileSync(opencodePath, `${JSON.stringify(opencodeConfig, null, 2)}\n`);

  const environmentPath = join(environmentDirectory, 'context7.environment.json');
  if (environmentContent !== undefined) writeFileSync(environmentPath, environmentContent, { mode: 0o600 });

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    TEST_LAUNCHCTL_LOG: launchctlLog,
  };

  return { root, home, env, launchctlLog, opencodePath, opencodeConfig, backlogAllowMap, environmentPath };
}

function invokeSync(fixture) {
  const result = spawnSync(process.execPath, [scriptPath, canonicalPath], {
    cwd: dirname(canonicalPath),
    encoding: 'utf8',
    env: fixture.env,
  });
  assert.ifError(result.error);
  return result;
}

function readFixtureState(fixture) {
  const config = JSON.parse(readFileSync(fixture.opencodePath, 'utf8'));
  const launchctlCalls = readFileSync(fixture.launchctlLog, 'utf8').trim().split('\n').filter(Boolean);
  return { config, launchctlCalls };
}

const skipLaunchd = process.platform === 'darwin' ? false : 'LaunchAgent の検証には macOS が必要です';

test('共有 daemon argv・Backlog の19件許可 map・既存設定の保持と再同期の冪等性', { skip: skipLaunchd }, (t) => {
  const fixture = makeFixture(t);
  const first = invokeSync(fixture);
  assert.equal(first.status, 0, first.stderr);

  const context7 = getDaemonPlist(fixture.home, 'com.efoo-team.context7-mcp');
  const devtools = getDaemonPlist(fixture.home, 'com.efoo-team.chrome-devtools-mcp');
  const playwright = getDaemonPlist(fixture.home, 'com.efoo-team.playwright-mcp');
  const contextArgs = readProgramArguments(context7.plist);
  const devtoolsArgs = readProgramArguments(devtools.plist);
  const playwrightArgs = readProgramArguments(playwright.plist);

  const expectedContextTail = [
    '-y', '--prefer-offline', '--ignore-scripts', 'mcp-proxy@6.7.19', '--port', '8932', '--host', '127.0.0.1',
    '--server', 'stream', '--', 'npx', '-y', '--prefer-offline', '--ignore-scripts', '@upstash/context7-mcp@4.4.2',
  ];
  const expectedDevtoolsTail = [
    '-y', '--prefer-offline', '--ignore-scripts', 'mcp-proxy@6.7.19', '--port', '8933', '--host', '127.0.0.1',
    '--server', 'stream', '--', 'npx', '-y', '--prefer-offline', '--ignore-scripts', 'chrome-devtools-mcp@1.11.0',
  ];
  assert.deepEqual(contextArgs.slice(1), expectedContextTail);
  assert.deepEqual(devtoolsArgs.slice(1), expectedDevtoolsTail);
  assert.deepEqual(playwrightArgs.slice(1), [
    '-y', '--prefer-offline', '@playwright/mcp@0.0.79', '--port', '8931', '--isolated', '--browser=chrome-beta',
  ]);

  const firstState = readFixtureState(fixture);
  assert.deepEqual(firstState.config.tools, fixture.backlogAllowMap);
  assert.deepEqual(firstState.config.mcp['backlog-server'], fixture.opencodeConfig.mcp['backlog-server']);
  assert.equal(Object.keys(firstState.config.tools).length, 19);
  assert.equal((firstState.config.mcp.context7.url), 'http://127.0.0.1:8932/mcp');
  assert.equal((firstState.config.mcp['chrome-devtools'].url), 'http://127.0.0.1:8933/mcp');

  const second = invokeSync(fixture);
  assert.equal(second.status, 0, second.stderr);
  const secondState = readFixtureState(fixture);
  assert.deepEqual(secondState.config.tools, fixture.backlogAllowMap);
  assert.deepEqual(secondState.config.mcp['backlog-server'], fixture.opencodeConfig.mcp['backlog-server']);
  assert.deepEqual(
    secondState.launchctlCalls,
    [...firstState.launchctlCalls, 'print', 'print', 'print'],
    JSON.stringify({ firstCalls: firstState.launchctlCalls, secondCalls: secondState.launchctlCalls, stdout: second.stdout, stderr: second.stderr }),
  );
  assert.deepEqual(firstState.launchctlCalls, ['bootout', 'bootstrap', 'bootout', 'bootstrap', 'bootout', 'bootstrap']);

  evidence.push({
    scenario: 'shared daemon argv, Backlog map preservation, and idempotent resync',
    invocation: `node ${scriptPath} ${canonicalPath}`,
    exitCodes: [first.status, second.status],
    proxyBackendArgvChecked: true,
    directPlaywrightArgvChecked: true,
    backlogAllowMapCount: Object.keys(secondState.config.tools).length,
    backlogAllowMapPreserved: true,
    secondSyncLaunchctlCalls: secondState.launchctlCalls.slice(firstState.launchctlCalls.length),
  });
});

test('environmentFile が無い場合は匿名接続、存在する場合は env に反映し plist を0600にする', { skip: skipLaunchd }, (t) => {
  const absentFixture = makeFixture(t);
  const absentResult = invokeSync(absentFixture);
  assert.equal(absentResult.status, 0, absentResult.stderr);
  const absentPlist = getDaemonPlist(absentFixture.home, 'com.efoo-team.context7-mcp');
  const absentEnvironment = readEnvironment(absentPlist.plist);
  assert.equal(absentEnvironment.CONTEXT7_API_KEY, undefined);
  assert.equal(statSync(absentPlist.plistPath).mode & 0o777, 0o600);

  const fakeSecret = 'fixture-secret-&-<value>';
  const validFixture = makeFixture(t, JSON.stringify({ CONTEXT7_API_KEY: fakeSecret }));
  const validResult = invokeSync(validFixture);
  assert.equal(validResult.status, 0, validResult.stderr);
  const validPlist = getDaemonPlist(validFixture.home, 'com.efoo-team.context7-mcp');
  const validEnvironment = readEnvironment(validPlist.plist);
  assert.ok(validEnvironment.CONTEXT7_API_KEY === fakeSecret, 'API key is present in the daemon environment');
  assert.equal(statSync(validPlist.plistPath).mode & 0o777, 0o600);
  assert.ok(!validResult.stdout.includes(fakeSecret));
  assert.ok(!validResult.stderr.includes(fakeSecret));

  evidence.push({
    scenario: 'environment file absent and valid',
    invocation: `node ${scriptPath} ${canonicalPath}`,
    exitCodes: [absentResult.status, validResult.status],
    absentFileStartsWithoutApiKey: absentEnvironment.CONTEXT7_API_KEY === undefined,
    validFileSetsApiKey: validEnvironment.CONTEXT7_API_KEY === fakeSecret,
    plistModes: [statSync(absentPlist.plistPath).mode & 0o777, statSync(validPlist.plistPath).mode & 0o777],
    secretOmittedFromOutput: true,
  });
});

test('environmentFile の不正JSONと不正な値は秘密を表示せず daemon 更新を止める', { skip: skipLaunchd }, (t) => {
  const invalidCases = [
    { content: '{"CONTEXT7_API_KEY":"never-print-this",}', label: 'invalid JSON' },
    { content: JSON.stringify(['never-print-this']), label: 'non-object JSON' },
    { content: JSON.stringify({ CONTEXT7_API_KEY: 42, marker: 'never-print-this' }), label: 'non-string value' },
    { content: JSON.stringify({ PATH: 'never-print-this' }), label: 'reserved environment name' },
    { content: JSON.stringify({ CONTEXT7_API_KEY: 'never-print-this' }), label: 'file permissions are too broad', mode: 0o644 },
  ];
  const outputs = [];

  for (const invalidCase of invalidCases) {
    const fixture = makeFixture(t, invalidCase.content);
    if (invalidCase.mode) chmodSync(fixture.environmentPath, invalidCase.mode);
    const result = invokeSync(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /context7: environmentFile を読み込めないか形式が不正/);
    assert.ok(!result.stdout.includes('never-print-this'));
    assert.ok(!result.stderr.includes('never-print-this'));
    assert.throws(() => getDaemonPlist(fixture.home, 'com.efoo-team.context7-mcp'));
    outputs.push({ label: invalidCase.label, exitCode: result.status, secretOmittedFromOutput: true, daemonWasNotWritten: true });
  }

  evidence.push({
    scenario: 'invalid environment file rejected without logging values',
    invocation: `node ${scriptPath} ${canonicalPath}`,
    cases: outputs,
  });
});

test('mcp-servers.json stores only the optional Context7 environment-file path', () => {
  const spec = JSON.parse(readFileSync(canonicalPath, 'utf8'));
  const context7 = spec.servers.context7;
  assert.equal(context7.daemon.environmentFile, '~/.config/efoo-team/mcp/context7.environment.json');
  assert.equal(Object.hasOwn(context7, 'env'), false);
  assert.equal(JSON.stringify(context7).includes('fixture-secret'), false);
  evidence.push({
    scenario: 'canonical spec contains environment-file path only',
    invocation: `node --test ${fileURLToPath(import.meta.url)}`,
    environmentFilePath: context7.daemon.environmentFile,
    secretValueInCanonicalDefinition: false,
  });
});
