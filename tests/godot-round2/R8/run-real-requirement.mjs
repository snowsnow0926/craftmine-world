// R8 · first real-model requirement through the real product adapter.
//
// Drives the pinned PI agent runtime, the real craftmine.world plugin subprocess
// and the real craftmine-core binary. The model writes a Godot project through
// the product's own tools; the driver only reads the product back and judges it
// with the frozen task-I assertions. It never simulates input and never writes
// the project itself.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadFrozenSpec, roundsOf, indexAssertions, ROOT} from '../../godot-remaining/I/lib/frozen.mjs';
import {evaluateRound} from '../../godot-remaining/I/lib/verdict.mjs';
import {createEvidenceBundle} from '../../godot-remaining/I/lib/evidence.mjs';
import {classifyFailure} from '../../godot-remaining/I/lib/classify.mjs';
import {buildReport, writeReport} from '../../godot-remaining/I/lib/report.mjs';
import {initialState, refresh, ledgerRows} from '../../godot-remaining/I/lib/ledger.mjs';
import {probePiPlugin, createPiPluginSession, piPluginConfig} from '../../godot-remaining/I/lib/transport/pi-plugin.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const EXIT = {OK: 0, HARD_FAILURE: 1, BLOCKED: 3};

const SYSTEM_PROMPT = [
  '你是 craftmine world / 最中幻想里的世界创作助手。',
  '根据玩家要求，用提供的 Godot 工程工具真实写入源码；先看工程现状，再写。',
  '不要模拟工具调用或工具结果，只把工具真实返回的内容当作事实。',
  '遵守工具返回的真实错误并修复；只把已经通过工具完成的工作报告为完成。',
  '不要调用验收或评分相关的任何东西，也不要尝试修改测试。',
].join('');

// Source-level evidence. These are heuristics over the model's real output; they
// prove source intent only and never stand in for runtime observation.
// Comments are stripped first so a doc comment cannot satisfy a code check.
const CENTERED_PATTERNS = [
  /size\s*\*\s*0?\.5/,
  /size\s*\/\s*2\b/,
  /size\s*\*\s*Vector2\(\s*0?\.5/,
  /anchor_(left|right|top|bottom)\s*=\s*0?\.5/,
  /PRESET_CENTER/,
  /(get_viewport\(\)\.get_visible_rect\(\)|get_viewport_rect\(\))\.size\s*\/\s*2/,
];
const CROSSHAIR_CONTEXT = /(crosshair|reticle|准星|瞄准)/i;
const CAMERA_ATTACH_PATTERNS = [
  /(camera|Camera3D)[^\n]{0,80}\.add_child\s*\(/,
  /parent\s*=\s*"[^"]*Camera3D[^"]*"/,
  /get_node\s*\(\s*"[^"]*Camera3D[^"]*"\s*\)\s*\.\s*add_child\s*\(/,
];
const WEAPON_MENTION = /(weapon|view_model|viewmodel|pistol|rifle|sword|gun|枪|剑|武器)/i;
const EQUIP_CALL = /(equip|set_style|next_equipment|switch_weapon|change_weapon)\s*\(/;
const EQUIPMENT_IDS = /["'](gun|sword|pistol|rifle|weapon_?\w*)["']/gi;

export function sourceEvidence(files) {
  const texts = files.map(file => ({path: file.path, code: stripComments(String(file.text ?? ''))}));
  const joined = texts.map(entry => entry.code).join('\n');
  // File paths are evidence (not comments), so a crosshair script still counts.
  const contextText = `${joined}\n${texts.map(entry => entry.path).join('\n')}`;
  const code = pattern => pattern.test(joined);
  const equipmentIds = new Set([...joined.matchAll(EQUIPMENT_IDS)].map(match => match[1].toLowerCase()));
  const scriptFiles = texts.filter(entry => /\.(gd|tscn|tres)$/i.test(entry.path));
  return {
    projectGodot: texts.some(entry => /(^|\/)project\.godot$/i.test(entry.path)),
    hasScripts: scriptFiles.length > 0,
    crosshairCentered: CROSSHAIR_CONTEXT.test(contextText) && CENTERED_PATTERNS.some(pattern => pattern.test(joined)),
    weaponUnderCamera: /Camera3D/.test(joined) && CAMERA_ATTACH_PATTERNS.some(pattern => pattern.test(joined)) && WEAPON_MENTION.test(joined),
    equipmentSwitch: equipmentIds.size >= 2 && EQUIP_CALL.test(joined),
    equipmentIds: [...equipmentIds],
    scriptCount: scriptFiles.length,
    scannedBytes: joined.length,
  };
}

function stripComments(text) {
  return text.split('\n').map(line => line.replace(/#.*$/, '')).join('\n');
}

async function observeProject(session, {previousManifestHash = null} = {}) {
  const index = await session.readProject();
  const project = {files: [], baseId: null, status: null, manifestHash: null, revision: null, fileCount: 0};
  if (index.ok) {
    const result = index.result;
    project.baseId = result.baseId ?? null;
    project.status = result.status ?? null;
    project.manifestHash = result.manifestHash ?? null;
    project.revision = result.revision ?? 0;
    project.fileCount = (result.files ?? []).length;
    const files = [];
    for (const entry of (result.files ?? []).slice(0, 24)) {
      const read = await session.readFile(entry.path, {revision: project.revision, manifestHash: project.manifestHash});
      files.push({path: entry.path, sha256: entry.sha256, bytes: entry.bytes, text: read.ok ? (read.result.text ?? read.result.content ?? '') : ''});
    }
    project.files = files.map(({text, ...rest}) => rest);
    project.sourceEvidence = sourceEvidence(files);
    project.manifestHashChanged = previousManifestHash === null ? null : previousManifestHash !== project.manifestHash;
    return {project, build: await buildGate(session), texts: files};
  } else {
    project.error = index.error;
  }
  return {project, build: await buildGate(session), texts: []};
}

async function buildGate(session) {
  const info = await session.runtimeInfo().catch(error => ({godotExecutor: {state: 'error', reason: String(error.message)}}));
  return {
    executorState: info?.godotExecutor?.state ?? null,
    executorReason: info?.godotExecutor?.reason ?? null,
    available: info?.godotBuildAvailable === true,
    checked: info?.godotCheckAvailable === true,
  };
}

function toolCallsSince(session, index) {
  return session.calls.slice(index).map(call => ({name: call.name, ok: call.ok !== false, code: call.code ?? null, error: call.error ?? null}));
}

function failuresSince(session, index) {
  return session.calls.slice(index).filter(call => call.ok === false).map(call => classifyFailure({stage: `tool:${call.name}`, message: call.error ?? ''}));
}

export async function runRealRequirement({env = process.env, outDir = null} = {}) {
  const config = piPluginConfig(env, REPO);
  const probe = await probePiPlugin({env, root: REPO});
  const outRoot = outDir ?? path.join(REPO, 'test-results', `r8-real-${Date.now()}`);
  fs.mkdirSync(path.join(outRoot, 'evidence'), {recursive: true});
  const started = new Date().toISOString();
  if (!probe.available) {
    const report = {format: 'craftmine.r8.real-requirement/1', generatedAt: started, refused: true, mode: 'live', reasons: [probe.reason, probe.detail].filter(Boolean)};
    const written = writeReport(outRoot, report);
    return {exitCode: EXIT.BLOCKED, report, written, outRoot};
  }

  const spec = loadFrozenSpec({root: ROOT});
  const byId = indexAssertions(spec.assertions);
  const rounds = roundsOf(spec.set).filter(round => round.id === 'R15.1' || round.id === 'R15.2');
  const session = await createPiPluginSession({config, onEvent: event => { if (event.type === 'tool-call') process.stdout.write(`  tool ${event.name}\n`); }});
  const identity = {
    product: {version: `core@${session.identity.core.sha256.slice(0, 12)}`, clientVersion: 'plugin@0.1.0', commit: gitHead(REPO)},
    engine: {name: 'godot', version: session.identity.engine.version, renderer: session.identity.engine.renderer},
    base: {id: null, version: null, commit: null},
    project: {treeHash: null, path: null, fileCount: null},
    model: {...session.identity.model},
    input: session.identity.inputPolicy,
    dataDir: session.dataDir,
  };
  const results = [];
  const transcript = [];
  let previousManifestHash = null;
  try {
    const world = await session.createWorld('R8 真实模型验收世界');
    identity.base = {id: 'first-person', version: world.build?.id ?? null, commit: null};

    for (const round of rounds) {
      const evidence = createEvidenceBundle({root: path.join(outRoot, 'evidence'), roundId: round.id, mode: 'live', identity});
      evidence.writeJson('round.json', {id: round.id, prompt: round.prompt, mustObserve: round.mustObserve, blockedBy: round.blockedBy ?? [], limits: round.limits ?? null});
      evidence.rawRequest(round.prompt);
      const callStart = session.calls.length;
      const requestStart = session.requests.length;
      let observation = null;
      let verdict = null;
      try {
        let observed = null;
        const turn = await session.prompt(round.prompt, {systemPrompt: SYSTEM_PROMPT, beforeEnd: async () => { observed = await observeProject(session, {previousManifestHash}); }});
        evidence.writeJson('turn.json', turn);
        if (!observed) observed = await observeProject(session, {previousManifestHash});
        const writes = session.calls.slice(callStart).filter(call => ['godot_project_create', 'godot_project_patch', 'godot_asset_put'].includes(call.name));
        observation = {
          format: 'craftmine.i.observation/1',
          project: observed.project,
          build: observed.build,
          writes: {attempted: writes.length, failed: writes.filter(call => call.ok === false).length, names: writes.map(call => call.name)},
          toolCalls: toolCallsSince(session, callStart),
          usage: session.usage(),
          failures: failuresSince(session, callStart),
          humanInterventions: [],
          evidence: {screenshots: [], human: []},
        };
        evidence.rawResponse(JSON.stringify(session.transcript().slice(-4), null, 2));
        evidence.writeJson('observation.json', observation);
        evidence.writeJson('project-files.json', (observed.texts ?? []).map(({path: filePath, sha256, bytes, text}) => ({path: filePath, sha256, bytes, text})));
        evidence.usage({stage: 'creation', source: 'model-usage', ...session.usage()});
        for (const failure of observation.failures) evidence.failure(failure);
        if (observed.project.manifestHash) previousManifestHash = observed.project.manifestHash;
        identity.project = {treeHash: observed.project.manifestHash, path: 'godot-project', fileCount: observed.project.fileCount};
        identity.base.version = observed.project.baseId ?? identity.base.version;
        const roundIdentity = {...identity, project: {...identity.project}};
        verdict = evaluateRound({round, assertions: round.assertions.map(id => byId.get(id)), observation, identity: roundIdentity, mode: 'live', artifacts: []});
        verdict = {...verdict, modelCalls: session.requests.length - requestStart};
        evidence.writeJson('assertions.json', verdict.assertions);
      } catch (error) {
        evidence.failure(classifyFailure({stage: `round:${round.id}`, message: error.message, error}));
        verdict = {roundId: round.id, mode: 'live', verdict: 'failed', reasons: [error.message], assertions: [], hardFailures: [{class: 'model-wrong-behavior', message: error.message}], missingEvidence: [], identityMissing: [], modelCalls: 0};
      }
      const sealed = evidence.finalize({verdict: verdict.verdict, reasons: verdict.reasons ?? []});
      results.push({...round, ...verdict, build: observation?.build ?? null, evidenceDir: path.relative(outRoot, sealed.dir).split(path.sep).join('/'), usageCalls: sealed.usage?.calls ?? 0, unknownUsageCalls: sealed.usage?.unknownCalls ?? 0, humanInterventions: 0});
      await session.newTurn();
    }
    transcript.push(...session.transcript());
  } catch (error) {
    results.push({id: 'R15', roundId: 'R15', mode: 'live', verdict: 'failed', reasons: [String(error.message)], assertions: [], hardFailures: [{class: classifyFailure({message: error.message}).class, message: String(error.message)}], missingEvidence: [], identityMissing: [], modelCalls: 0});
  } finally {
    await session.close().catch(() => {});
  }

  fs.writeFileSync(path.join(outRoot, 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`);
  fs.writeFileSync(path.join(outRoot, 'tool-calls.json'), `${JSON.stringify(session.calls, null, 2)}\n`);
  const ledger = initialState(spec.ledgers);
  refresh(ledger, {rounds: results, ledgers: spec.ledgers});
  const report = buildReport({
    mode: 'live',
    identity,
    freeze: spec.verdict,
    rounds: results,
    ledger,
    metrics: {
      modelCalls: results.reduce((sum, round) => sum + (round.modelCalls ?? 0), 0),
      unknownUsageCalls: results.reduce((sum, round) => sum + (round.unknownUsageCalls ?? 0), 0),
      usageCalls: results.reduce((sum, round) => sum + (round.usageCalls ?? 0), 0),
      humanInterventions: 0,
      adapter: 'pi-plugin',
      productProbe: probe,
    },
    notes: [
      `真实产品适配器：PI agent runtime + craftmine.world 插件子进程 + ${path.basename(config.coreBin)}。`,
      `模型：${session.identity.model.provider}/${session.identity.model.modelId} thinking=${session.identity.model.thinking}。`,
      `构建门禁：${results.at(-1)?.build?.executorReason ?? '见观测'}（构建/检查未通过不代表源码未写出）。`,
      '源级证据只证明模型写出了符合要求的源码，不代替 R02.1/R02.2 的运行时断言。',
    ],
  });
  const written = writeReport(outRoot, report);
  fs.writeFileSync(path.join(outRoot, 'ledger-state.json'), `${JSON.stringify({format: 'craftmine.i.ledger-state/1', generatedAt: report.generatedAt, mode: 'live', items: ledgerRows(ledger)}, null, 2)}\n`);
  const hardFailed = results.filter(round => round.verdict === 'failed').length;
  const insufficient = results.filter(round => round.verdict === 'insufficient').length;
  return {exitCode: hardFailed ? EXIT.HARD_FAILURE : insufficient ? EXIT.HARD_FAILURE : EXIT.OK, report, written, outRoot};
}

function gitHead(root) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(); }
  catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const result = await runRealRequirement({outDir: out});
  const {report} = result;
  if (report.refused) console.error(`blocked: ${report.reasons.join('; ')}`);
  else {
    const h = report.headline;
    console.log(`real requirement: rounds=${h.rounds} passed=${h.passed} failed=${h.failed} insufficient=${h.insufficient} modelCalls=${h.modelCalls} unknownUsage=${h.unknownUsageCalls}`);
    console.log(`report: ${result.written.md}`);
  }
  process.exitCode = result.exitCode;
}
