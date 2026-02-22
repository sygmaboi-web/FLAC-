'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.DOWNLOADER_PORT || '4317', 10) || 4317;
const POWERSHELL_EXE = process.env.POWERSHELL_EXE || 'powershell.exe';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_LOG_LINES = 120;
const MAX_JOB_HISTORY = 40;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOWNLOADER_SCRIPT = path.join(__dirname, 'download-youtube-flac.ps1');

if (!fs.existsSync(DOWNLOADER_SCRIPT)) {
  console.error(`[bridge] missing downloader script: ${DOWNLOADER_SCRIPT}`);
  process.exit(1);
}

const jobs = new Map();
let jobCounter = 0;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', (error) => reject(error));
  });
}

function isYouTubeUrl(value) {
  return /^https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\//i.test(String(value || '').trim());
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function pruneJobs() {
  if (jobs.size <= MAX_JOB_HISTORY) return;
  const oldest = jobs.keys().next().value;
  if (oldest) jobs.delete(oldest);
}

function appendJobLog(job, type, chunk) {
  const lines = String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `[${type}] ${line}`);

  if (!lines.length) return;
  job.logs.push(...lines);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
}

function buildPayload(input) {
  const payload = {
    url: String(input.url || '').trim(),
    mode: input.mode === 'playlist' ? 'playlist' : 'single',
    playlistStart: parsePositiveInteger(input.playlistStart),
    playlistEnd: parsePositiveInteger(input.playlistEnd),
    dryRun: Boolean(input.dryRun)
  };

  if (!payload.url) {
    throw new Error('URL is required.');
  }
  if (!isYouTubeUrl(payload.url)) {
    throw new Error('Only YouTube URLs are supported.');
  }
  if (payload.mode !== 'playlist' && (payload.playlistStart || payload.playlistEnd)) {
    throw new Error('Playlist range can only be used when mode=playlist.');
  }
  if (payload.playlistStart && payload.playlistEnd && payload.playlistEnd < payload.playlistStart) {
    throw new Error('playlistEnd must be greater than or equal to playlistStart.');
  }

  return payload;
}

function createPowerShellArgs(payload) {
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', DOWNLOADER_SCRIPT,
    '-Url', payload.url
  ];

  if (payload.mode === 'playlist') args.push('-Playlist');
  if (payload.mode === 'playlist' && payload.playlistStart) args.push('-PlaylistStart', String(payload.playlistStart));
  if (payload.mode === 'playlist' && payload.playlistEnd) args.push('-PlaylistEnd', String(payload.playlistEnd));
  if (payload.dryRun) args.push('-DryRun');

  return args;
}

function startDownloadJob(payload) {
  const jobId = `${Date.now()}-${++jobCounter}`;
  const args = createPowerShellArgs(payload);
  const startedAt = new Date().toISOString();

  const job = {
    id: jobId,
    status: 'running',
    mode: payload.mode,
    url: payload.url,
    playlistStart: payload.playlistStart,
    playlistEnd: payload.playlistEnd,
    dryRun: payload.dryRun,
    startedAt,
    finishedAt: null,
    exitCode: null,
    logs: []
  };

  jobs.set(jobId, job);
  pruneJobs();

  const child = spawn(POWERSHELL_EXE, args, {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => appendJobLog(job, 'out', chunk));
  child.stderr.on('data', (chunk) => appendJobLog(job, 'err', chunk));

  child.on('error', (error) => {
    appendJobLog(job, 'err', error.message || error);
    job.status = 'failed';
    job.exitCode = -1;
    job.finishedAt = new Date().toISOString();
  });

  child.on('close', (code) => {
    job.exitCode = Number.isInteger(code) ? code : -1;
    job.status = code === 0 ? 'completed' : 'failed';
    job.finishedAt = new Date().toISOString();
  });

  return job;
}

function summarizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    url: job.url,
    playlistStart: job.playlistStart,
    playlistEnd: job.playlistEnd,
    dryRun: job.dryRun,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    logs: job.logs.slice(-20)
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'downloader-bridge',
      script: DOWNLOADER_SCRIPT,
      runningJobs: Array.from(jobs.values()).filter((job) => job.status === 'running').length
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/download/status') {
    const id = String(requestUrl.searchParams.get('id') || '').trim();
    if (id) {
      const job = jobs.get(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: 'Job not found.' });
        return;
      }
      sendJson(res, 200, { ok: true, job: summarizeJob(job) });
      return;
    }

    const recent = Array.from(jobs.values())
      .slice(-10)
      .map((job) => ({
        id: job.id,
        status: job.status,
        mode: job.mode,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        exitCode: job.exitCode
      }));
    sendJson(res, 200, { ok: true, jobs: recent });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/download') {
    try {
      const requestBody = await readJsonBody(req);
      const payload = buildPayload(requestBody);
      const job = startDownloadJob(payload);

      sendJson(res, 202, {
        ok: true,
        jobId: job.id,
        status: job.status,
        message: `Download started (${job.mode}).`,
        statusUrl: `/api/download/status?id=${encodeURIComponent(job.id)}`
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to process request.' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Route not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] running at http://${HOST}:${PORT}`);
  console.log(`[bridge] downloader script: ${DOWNLOADER_SCRIPT}`);
  console.log('[bridge] keep this terminal open while using the web download button.');
});
