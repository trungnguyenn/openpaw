#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function parseDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseArgs(argv) {
  const args = {
    envFile: '.env',
    prompt: 'Reply with exactly: OK',
    timeoutMs: 120000,
    models: null,
    runs: 1,
    maxAttempts: 1,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--env-file' && argv[i + 1]) {
      args.envFile = argv[++i];
      continue;
    }
    if (arg === '--prompt' && argv[i + 1]) {
      args.prompt = argv[++i];
      continue;
    }
    if (arg === '--timeout-ms' && argv[i + 1]) {
      args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
      continue;
    }
    if (arg === '--models' && argv[i + 1]) {
      args.models = argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === '--runs' && argv[i + 1]) {
      args.runs = Math.max(1, Number(argv[++i]) || 1);
      continue;
    }
    if (arg === '--max-attempts' && argv[i + 1]) {
      args.maxAttempts = Math.max(1, Number(argv[++i]) || 1);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  node scripts/test-nanoclaw-agent-models.mjs [options]

Options:
  --env-file <path>     Path to .env file (default: .env)
  --models <csv>        Explicit model list (comma-separated)
  --runs <n>            Number of runs per model (default: 1)
  --max-attempts <n>    Retries per run until success (default: 1)
  --prompt <text>       Prompt to send (default: "Reply with exactly: OK")
  --timeout-ms <n>      Per-model timeout in milliseconds (default: 120000)
`);
      process.exit(0);
    }
  }

  return args;
}

function getEnvValue(processEnv, dotenv, key) {
  const value = processEnv[key] ?? dotenv[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildModelList(processEnv, dotenv, explicitModels) {
  if (explicitModels && explicitModels.length > 0) {
    return Array.from(new Set(explicitModels));
  }

  const candidates = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ]
    .map((key) => getEnvValue(processEnv, dotenv, key))
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

function extractRunnerOutput(stdout) {
  const matches = [];
  const regex = new RegExp(
    `${OUTPUT_START_MARKER}\\s*([\\s\\S]*?)\\s*${OUTPUT_END_MARKER}`,
    'g',
  );
  for (const match of stdout.matchAll(regex)) {
    matches.push(match[1]);
  }
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function extractModelSelection(stderr) {
  const m = stderr.match(/Model selection:[^\n]*/);
  return m ? m[0] : null;
}

function isSuccessResult(result) {
  return Boolean(
    result?.parsed &&
      result.parsed.status === 'success' &&
      typeof result.parsed.result === 'string' &&
      result.parsed.result.trim().length > 0,
  );
}

function runOneModel({
  model,
  timeoutMs,
  prompt,
  sharedSecrets,
  mountRunnerSrc,
}) {
  return new Promise((resolve) => {
    const containerName = `nanoclaw-model-test-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    const args = [
      'run',
      '-i',
      '--rm',
      '--name',
      containerName,
      '-e',
      `TZ=${process.env.TZ || 'UTC'}`,
      '-v',
      `${mountRunnerSrc}:/app/src`,
      'nanoclaw-agent:latest',
    ];

    const inputPayload = {
      prompt,
      groupFolder: 'model-smoke-test',
      chatJid: 'tg:test',
      isMain: false,
      assistantName: 'ModelSmokeTest',
      secrets: {
        ...sharedSecrets,
        ANTHROPIC_MODEL: model,
      },
    };

    const proc = spawn('container', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      const parsed = extractRunnerOutput(stdout);
      const selection = extractModelSelection(stderr);
      resolve({
        model,
        code,
        signal,
        timedOut,
        parsed,
        selection,
        stderr,
      });
    });

    proc.stdin.write(JSON.stringify(inputPayload));
    proc.stdin.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = path.resolve(process.cwd(), args.envFile);
  const dotenv = parseDotEnv(envPath);

  const authToken = getEnvValue(process.env, dotenv, 'ANTHROPIC_AUTH_TOKEN');
  const apiKey = getEnvValue(process.env, dotenv, 'ANTHROPIC_API_KEY');
  const oauth = getEnvValue(process.env, dotenv, 'CLAUDE_CODE_OAUTH_TOKEN');
  const baseUrl = getEnvValue(process.env, dotenv, 'ANTHROPIC_BASE_URL');
  const fallback = getEnvValue(process.env, dotenv, 'ANTHROPIC_SMALL_FAST_MODEL');

  const models = buildModelList(process.env, dotenv, args.models);
  if (models.length === 0) {
    console.error('No configured models found. Set --models or add model vars to .env.');
    process.exit(1);
  }
  if (!authToken && !apiKey && !oauth) {
    console.error('No auth secret found. Set ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN.');
    process.exit(1);
  }

  const sharedSecrets = {};
  if (authToken) sharedSecrets.ANTHROPIC_AUTH_TOKEN = authToken;
  if (apiKey) sharedSecrets.ANTHROPIC_API_KEY = apiKey;
  if (oauth) sharedSecrets.CLAUDE_CODE_OAUTH_TOKEN = oauth;
  if (baseUrl) sharedSecrets.ANTHROPIC_BASE_URL = baseUrl;
  if (fallback) sharedSecrets.ANTHROPIC_SMALL_FAST_MODEL = fallback;
  const mountRunnerSrc = path.resolve(
    process.cwd(),
    'container',
    'agent-runner',
    'src',
  );
  if (!fs.existsSync(mountRunnerSrc)) {
    console.error(`Runner source not found: ${mountRunnerSrc}`);
    process.exit(1);
  }

  console.log(
    `Testing ${models.length} model(s), runs/model=${args.runs}, max_attempts=${args.maxAttempts}, image=nanoclaw-agent:latest`,
  );
  console.log(`Using runner source mount: ${mountRunnerSrc} -> /app/src`);

  const results = [];
  const startedAt = Date.now();
  for (const model of models) {
    for (let run = 1; run <= args.runs; run++) {
      console.log(`\n--- Testing model: ${model} (run ${run}/${args.runs})`);
      const runAttempts = [];
      let eventualSuccess = false;
      for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
        if (args.maxAttempts > 1) {
          console.log(`attempt=${attempt}/${args.maxAttempts}`);
        }
        const runStart = Date.now();
        const result = await runOneModel({
          model,
          timeoutMs: args.timeoutMs,
          prompt: args.prompt,
          sharedSecrets,
          mountRunnerSrc,
        });
        const durationMs = Date.now() - runStart;
        result.durationMs = durationMs;
        result.run = run;
        result.attempt = attempt;
        runAttempts.push(result);
        results.push(result);

        const ok = isSuccessResult(result);
        console.log(
          `exit_code=${result.code} timed_out=${result.timedOut} duration_ms=${durationMs}`,
        );
        if (result.selection) console.log(result.selection);
        if (ok) {
          console.log(`result=${JSON.stringify(result.parsed.result.slice(0, 200))}`);
          if (result.code !== 0) {
            console.log(
              `note=non-zero container exit (${result.code}) but successful runner output was produced`,
            );
          }
          eventualSuccess = true;
          break;
        }
        if (result.parsed?.error) {
          console.log(`error=${result.parsed.error}`);
        } else {
          const tail = result.stderr.split('\n').slice(-8).join('\n').trim();
          if (tail) console.log(`stderr_tail:\n${tail}`);
        }
      }
      const firstTrySuccess = runAttempts.length > 0 && isSuccessResult(runAttempts[0]);
      console.log(
        `run_result: first_try_success=${firstTrySuccess} eventual_success=${eventualSuccess} attempts_used=${runAttempts.length}`,
      );
    }
  }

  const passedAttempts = results.filter((r) => isSuccessResult(r)).length;
  const failedAttempts = results.length - passedAttempts;

  console.log(
    `\nSummary (attempt-level): passed=${passedAttempts} failed=${failedAttempts} total=${results.length} elapsed_ms=${Date.now() - startedAt}`,
  );

  console.log('\nPer-model summary:');
  for (const model of models) {
    const modelRuns = results.filter((r) => r.model === model);
    const modelPassed = modelRuns.filter((r) => isSuccessResult(r));
    const durations = modelRuns
      .map((r) => r.durationMs)
      .filter((d) => Number.isFinite(d))
      .sort((a, b) => a - b);
    const medianMs =
      durations.length === 0
        ? 0
        : durations[Math.floor(durations.length / 2)];
    const exit137Count = modelRuns.filter((r) => r.code === 137).length;
    const timeoutCount = modelRuns.filter((r) => r.timedOut).length;
    const runGroups = new Map();
    for (const attempt of modelRuns) {
      const runKey = attempt.run;
      if (!runGroups.has(runKey)) runGroups.set(runKey, []);
      runGroups.get(runKey).push(attempt);
    }
    const logicalRuns = Array.from(runGroups.keys()).length;
    let firstTryPass = 0;
    let eventualPass = 0;
    let attemptsUsedTotal = 0;
    for (const attempts of runGroups.values()) {
      attempts.sort((a, b) => a.attempt - b.attempt);
      const first = attempts[0];
      if (first && isSuccessResult(first)) firstTryPass++;
      const anySuccess = attempts.some((a) => isSuccessResult(a));
      if (anySuccess) eventualPass++;
      attemptsUsedTotal += attempts.length;
    }
    const avgAttemptsPerRun =
      logicalRuns > 0 ? (attemptsUsedTotal / logicalRuns).toFixed(2) : '0.00';
    console.log(
      `${model}: attempt_pass=${modelPassed.length}/${modelRuns.length} first_try_pass=${firstTryPass}/${logicalRuns} eventual_pass=${eventualPass}/${logicalRuns} eventual_success_rate=${logicalRuns > 0 ? ((eventualPass / logicalRuns) * 100).toFixed(1) : '0.0'}% avg_attempts_per_run=${avgAttemptsPerRun} median_ms=${medianMs} exit137=${exit137Count} timed_out=${timeoutCount}`,
    );
  }

  const logicalTotal = models.length * args.runs;
  let logicalEventualPass = 0;
  for (const model of models) {
    for (let run = 1; run <= args.runs; run++) {
      const attempts = results.filter((r) => r.model === model && r.run === run);
      if (attempts.some((a) => isSuccessResult(a))) logicalEventualPass++;
    }
  }
  const logicalEventualFail = logicalTotal - logicalEventualPass;
  console.log(
    `\nSummary (run-level): eventual_pass=${logicalEventualPass} eventual_fail=${logicalEventualFail} total_runs=${logicalTotal}`,
  );

  if (logicalEventualFail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
