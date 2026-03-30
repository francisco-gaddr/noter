const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const isMock = process.env.MLC_MOCK === '1';
const isWindows = process.platform === 'win32';

const getMlcCandidates = () => {
  const candidates = [];
  const envBinary = String(process.env.MLC_LLM_BIN || '').trim();
  if (envBinary) {
    candidates.push({ command: envBinary, prefixArgs: [], display: envBinary });
  }
  if (isWindows) {
    candidates.push(
      { command: 'py', prefixArgs: ['-m', 'mlc_llm'], display: 'py -m mlc_llm' },
      { command: 'python', prefixArgs: ['-m', 'mlc_llm'], display: 'python -m mlc_llm' }
    );
  } else {
    candidates.push(
      { command: 'python3', prefixArgs: ['-m', 'mlc_llm'], display: 'python3 -m mlc_llm' },
      { command: 'python', prefixArgs: ['-m', 'mlc_llm'], display: 'python -m mlc_llm' }
    );
  }
  candidates.push({ command: 'mlc_llm', prefixArgs: [], display: 'mlc_llm' });
  return candidates;
};

const canRunCommand = (command, args) => new Promise((resolve) => {
  const proc = spawn(command, [...args, '--help'], { stdio: 'ignore' });
  const timeout = setTimeout(() => {
    proc.kill();
    resolve(false);
  }, 4000);
  proc.on('error', () => {
    clearTimeout(timeout);
    resolve(false);
  });
  proc.on('exit', (code) => {
    clearTimeout(timeout);
    resolve(code === 0);
  });
});

const resolveMlcCommand = async () => {
  for (const candidate of getMlcCandidates()) {
    if (await canRunCommand(candidate.command, candidate.prefixArgs)) {
      return candidate;
    }
  }
  throw new Error('MLC-binären hittades inte. Appen försökte mlc_llm, py -m mlc_llm och python -m mlc_llm.');
};

const getModelsRoot = (baseDir) => path.join(baseDir, 'mlc_models');
const getIndexPath = (baseDir) => path.join(getModelsRoot(baseDir), 'index.json');

const readIndex = (baseDir) => {
  try {
    const raw = fs.readFileSync(getIndexPath(baseDir), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

const writeIndex = (baseDir, data) => {
  ensureDir(getModelsRoot(baseDir));
  fs.writeFileSync(getIndexPath(baseDir), JSON.stringify(data, null, 2));
};

const resolveQuant = (quant) => {
  const q = String(quant || 'Q4_K_M').toUpperCase();
  const map = {
    Q4_K_M: 'q4f16_1',
    Q5_K_M: 'q5f16_1',
    Q4_0: 'q4f16_1',
    Q5_0: 'q5f16_1',
    Q8_0: 'q8f16_1',
  };
  return map[q] || 'q4f16_1';
};

const extractQuant = (filename) => {
  const match = String(filename || '').match(/(q\d_[0-9a-z_]+|f16|f32)/i);
  return match ? match[1].toUpperCase() : undefined;
};

const downloadFile = async (url, dest, onProgress) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('Download failed');
  const total = Number(res.headers.get('content-length') || 0);
  ensureDir(path.dirname(dest));
  const fileStream = fs.createWriteStream(dest);
  let received = 0;
  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    received += chunk.length;
    if (total > 0) onProgress(Math.min(0.4, received / total * 0.4));
  });
  await pipeline(nodeStream, fileStream);
};

const runCommand = (cmd, args, onStdout) => new Promise((resolve, reject) => {
  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdout.on('data', (data) => {
    if (onStdout) onStdout(data.toString());
  });
  proc.stderr.on('data', (data) => {
    if (onStdout) onStdout(data.toString());
  });
  proc.on('error', reject);
  proc.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${cmd} exited with ${code}`));
  });
  return proc;
});

const runMlcCommand = async (args, onStdout) => {
  const resolved = await resolveMlcCommand();
  try {
    await runCommand(resolved.command, [...resolved.prefixArgs, ...args], onStdout);
  } catch (error) {
    throw new Error(`${resolved.display}: ${error.message}`);
  }
};

const ensureModelDir = (baseDir, modelId, quant) => {
  const safeId = String(modelId).replace(/[^\w.-]+/g, '_');
  const dir = path.join(getModelsRoot(baseDir), safeId, String(quant || 'Q4_K_M').toUpperCase());
  ensureDir(dir);
  return dir;
};

const getModels = (baseDir) => readIndex(baseDir);

const downloadAndConvert = async (baseDir, payload, onProgress) => {
  const modelId = payload?.modelId;
  const ggufUrl = payload?.ggufUrl;
  const quant = payload?.quant || 'Q4_K_M';
  const target = payload?.target || 'cuda';
  if (!modelId || !ggufUrl) throw new Error('modelId and ggufUrl required');

  const models = readIndex(baseDir);
  const existing = models.find((m) => m.modelId === modelId && m.quant === quant);
  if (existing) return existing;

  const tempDir = path.join(baseDir, 'mlc_tmp', `${Date.now()}`);
  ensureDir(tempDir);
  const ggufPath = path.join(tempDir, 'model.gguf');
  const outDir = ensureModelDir(baseDir, modelId, quant);

  if (onProgress) onProgress(0.05);
  if (isMock) {
    if (onProgress) onProgress(0.6);
    const entry = {
      id: `${modelId}:${quant}`,
      modelId,
      quant: String(quant || 'Q4_K_M').toUpperCase(),
      path: outDir,
      target,
      createdAt: new Date().toISOString(),
    };
    const updated = [entry, ...models.filter((m) => m.id !== entry.id)];
    writeIndex(baseDir, updated);
    if (onProgress) onProgress(1);
    return entry;
  }
  await downloadFile(ggufUrl, ggufPath, onProgress || (() => {}));

  if (onProgress) onProgress(0.5);
  let usedTarget = target;
  try {
    await runMlcCommand(['convert', ggufPath, '--quantization', resolveQuant(quant), '--target', target, '-o', outDir]);
  } catch (error) {
    if (target !== 'cpu') {
      usedTarget = 'cpu';
      await runMlcCommand(['convert', ggufPath, '--quantization', resolveQuant(quant), '--target', 'cpu', '-o', outDir]);
    } else {
      throw error;
    }
  }

  const configPath = path.join(outDir, 'mlc-chat-config.json');
  if (!fs.existsSync(configPath)) throw new Error('Invalid model package');

  const entry = {
    id: `${modelId}:${quant}`,
    modelId,
    quant: String(quant || 'Q4_K_M').toUpperCase(),
    path: outDir,
    target: usedTarget,
    createdAt: new Date().toISOString(),
  };
  const updated = [entry, ...models.filter((m) => m.id !== entry.id)];
  writeIndex(baseDir, updated);
  if (onProgress) onProgress(1);
  return entry;
};

const deleteModel = (baseDir, id) => {
  const models = readIndex(baseDir);
  const model = models.find((m) => m.id === id);
  if (!model) return false;
  fs.rmSync(model.path, { recursive: true, force: true });
  writeIndex(baseDir, models.filter((m) => m.id !== id));
  return true;
};

const chatProcesses = new Map();

const shouldRetryOnCpu = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('cuda') ||
    message.includes('gpu') ||
    message.includes('metal') ||
    message.includes('vulkan') ||
    message.includes('rocm') ||
    message.includes('device')
  );
};

const runChatCommand = (chatId, args, onToken) => new Promise((resolve, reject) => {
  resolveMlcCommand().then((resolved) => {
    const proc = spawn(resolved.command, [...resolved.prefixArgs, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (chatId) chatProcesses.set(chatId, proc);
  let stdoutText = '';
  let stderrText = '';
  proc.stdout.on('data', (data) => {
    const chunk = data.toString();
    stdoutText += chunk;
    if (onToken) onToken(chunk);
  });
  proc.stderr.on('data', (data) => {
    stderrText += data.toString();
  });
  proc.on('error', (err) => {
    if (chatId) chatProcesses.delete(chatId);
    reject(err);
  });
  proc.on('close', (code) => {
    if (chatId) chatProcesses.delete(chatId);
    if (code === 0) {
      resolve({ content: stdoutText, stderr: stderrText });
      return;
    }
    const details = stderrText.trim();
    reject(new Error(details ? `${resolved.display} exited with ${code}: ${details}` : `${resolved.display} exited with ${code}`));
  });
  }).catch(reject);
});

const runChat = async (_baseDir, payload, onToken) => {
  const modelPath = payload?.modelPath;
  const prompt = payload?.prompt || '';
  const chatId = payload?.chatId;
  if (!modelPath) throw new Error('modelPath required');
  if (isMock) {
    if (onToken) onToken(`Mock: ${prompt}`);
    return { content: `Mock: ${prompt}`, usedDevice: 'mock' };
  }
  const args = ['chat', modelPath, '--prompt', prompt];
  try {
    const result = await runChatCommand(chatId, args, onToken);
    return { content: result.content, usedDevice: 'default' };
  } catch (error) {
    if (!shouldRetryOnCpu(error)) {
      throw error;
    }
    const result = await runChatCommand(chatId, [...args, '--device', 'cpu'], onToken);
    return { content: result.content, usedDevice: 'cpu' };
  }
};

const cancelChat = (chatId) => {
  if (!chatId) return false;
  const proc = chatProcesses.get(chatId);
  if (!proc) return false;
  try {
    proc.kill('SIGTERM');
  } catch {}
  chatProcesses.delete(chatId);
  return true;
};

const searchModels = async (query) => {
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=20`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'noter-electron' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Search failed (${res.status}) ${text}`);
  }
  const data = await res.json();
  return data.map((m) => ({
    id: m.id,
    name: m.id?.split('/')?.[1] || m.id,
    author: m.author || m.id?.split('/')?.[0] || '',
    downloads: m.downloads || 0,
    likes: m.likes || 0,
    tags: m.tags || [],
  }));
};

const getModelFiles = async (modelId) => {
  const headers = { 'User-Agent': 'noter-electron' };
  const treeUrl = `https://huggingface.co/api/models/${encodeURIComponent(modelId)}/tree/main?recursive=true`;
  const treeRes = await fetch(treeUrl, { headers });
  if (treeRes.ok) {
    const data = await treeRes.json();
    const files = Array.isArray(data) ? data : (data.tree || []);
    return files
      .filter((f) => String(f?.path || '').endsWith('.gguf'))
      .map((f) => ({
        filename: f.path,
        size: f.size || 0,
        url: `https://huggingface.co/${modelId}/resolve/main/${f.path}`,
        quantization: extractQuant(f.path),
      }));
  }

  const modelUrl = `https://huggingface.co/api/models/${encodeURIComponent(modelId)}`;
  const modelRes = await fetch(modelUrl, { headers });
  if (!modelRes.ok) {
    const text = await modelRes.text().catch(() => '');
    throw new Error(`Files fetch failed (${modelRes.status}) ${text}`);
  }
  const data = await modelRes.json();
  const files = Array.isArray(data?.siblings) ? data.siblings : [];
  return files
    .filter((f) => String(f?.rfilename || '').endsWith('.gguf'))
    .map((f) => ({
      filename: f.rfilename,
      size: f.size || 0,
      url: `https://huggingface.co/${modelId}/resolve/main/${f.rfilename}`,
      quantization: extractQuant(f.rfilename),
    }));
};

module.exports = {
  getModels,
  downloadAndConvert,
  deleteModel,
  runChat,
  cancelChat,
  resolveMlcCommand,
  resolveQuant,
  ensureModelDir,
  shouldRetryOnCpu,
  searchModels,
  getModelFiles,
};
