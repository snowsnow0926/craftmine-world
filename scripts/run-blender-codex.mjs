// User-requested local Codex CLI, preserving exact model/reasoning configuration.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const [name, promptFile, resumeArg, imageArg] = process.argv.slice(2);
const resume = resumeArg === 'new' ? undefined : resumeArg;
if (!/^[a-z0-9-]+$/.test(name ?? '') || !promptFile) throw Error('run-blender-codex NAME PROMPT_FILE [SESSION_ID]');
const directory = path.join(root, 'test-results/codex-models/cli', name);
fs.mkdirSync(directory, {recursive: true});
const cli = 'C:/Users/WINDOWS/AppData/Local/OpenAI/Codex/bin/bffc5354119c8421/codex.exe';
const args = ['exec', ...(resume ? ['resume', resume] : ['--sandbox', 'danger-full-access', '--cd', root]),
  '--model', 'gpt-6-astra', '--config', 'model_reasoning_effort="xhigh"', '--config', 'approval_policy="never"',
  ...(imageArg ? ['--image', path.resolve(root, imageArg)] : []),
  '--json', '--output-last-message', path.join(directory, 'last-message.md'), '-'];
const prompt = fs.readFileSync(path.resolve(root, promptFile), 'utf8');
fs.writeFileSync(path.join(directory, 'invocation.json'), JSON.stringify({cli, args, cwd: root, model: 'gpt-6-astra',
  reasoningEffort: 'xhigh', startedAt: new Date().toISOString(), resume: resume ?? null,
  referenceImage: imageArg ? path.resolve(root, imageArg) : null, noAddedModelOrTurnBudgets: true}, null, 2));
const stdout = fs.createWriteStream(path.join(directory, 'events.jsonl'));
const stderr = fs.createWriteStream(path.join(directory, 'stderr.log'));
const child = spawn(cli, args, {cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
fs.writeFileSync(path.join(directory, 'process.json'), JSON.stringify({pid: child.pid, parentPid: process.pid}));
child.stdout.pipe(stdout); child.stderr.pipe(stderr);
child.stdin.end(prompt);
let partial = '';
child.stdout.on('data', chunk => {
  partial += chunk.toString('utf8');
  const lines = partial.split('\n'); partial = lines.pop();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (['thread.started', 'turn.completed', 'turn.failed', 'error'].includes(value.type)) console.log(JSON.stringify(value));
      else if (value.item?.type === 'agent_message') console.log(value.item.text);
    } catch {}
  }
});
process.once('SIGINT', () => child.kill()); process.once('SIGTERM', () => child.kill());
const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('close', resolve);});
fs.writeFileSync(path.join(directory, 'completion.json'), JSON.stringify({exitCode: code, finishedAt: new Date().toISOString()}));
console.log(JSON.stringify({name, exitCode: code, directory}));
process.exitCode = code ?? 1;
