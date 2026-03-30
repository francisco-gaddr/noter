import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

export type ResolvedMlcCommand = {
  command: string;
  prefixArgs: string[];
  display: string;
  source: 'env' | 'py-module' | 'python-module' | 'path' | 'python-scripts';
};

type Candidate = ResolvedMlcCommand;

const isWindows = process.platform === 'win32';

const dedupe = <T,>(items: T[]) => Array.from(new Set(items));

const listDirectories = async (root: string) => {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
};

const listPythonScriptDirs = async () => {
  if (!isWindows) {
    return [];
  }

  const home = os.homedir();
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Python') : '',
    home ? path.join(home, 'AppData', 'Local', 'Programs', 'Python') : '',
    home ? path.join(home, 'AppData', 'Roaming', 'Python') : '',
  ].filter(Boolean);

  const discovered = await Promise.all(candidates.map((root) => listDirectories(root)));
  return dedupe(discovered.flat().map((dir) => path.join(dir, 'Scripts')));
};

const executableExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const probeCandidate = async (candidate: Candidate) =>
  new Promise<boolean>((resolve) => {
    const proc = spawn(candidate.command, [...candidate.prefixArgs, '--help'], { stdio: 'ignore' });
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

const buildCandidates = async (): Promise<Candidate[]> => {
  const envBinary = (process.env.MLC_LLM_BIN || '').trim();
  const candidates: Candidate[] = [];

  if (envBinary) {
    candidates.push({
      command: envBinary,
      prefixArgs: [],
      display: envBinary,
      source: 'env',
    });
  }

  if (isWindows) {
    candidates.push(
      {
        command: 'py',
        prefixArgs: ['-m', 'mlc_llm'],
        display: 'py -m mlc_llm',
        source: 'py-module',
      },
      {
        command: 'python',
        prefixArgs: ['-m', 'mlc_llm'],
        display: 'python -m mlc_llm',
        source: 'python-module',
      }
    );

    const scriptDirs = await listPythonScriptDirs();
    for (const scriptsDir of scriptDirs) {
      for (const fileName of ['mlc_llm.exe', 'mlc_llm.cmd']) {
        const filePath = path.join(scriptsDir, fileName);
        if (await executableExists(filePath)) {
          candidates.push({
            command: filePath,
            prefixArgs: [],
            display: filePath,
            source: 'python-scripts',
          });
        }
      }
    }
  } else {
    candidates.push(
      {
        command: 'python3',
        prefixArgs: ['-m', 'mlc_llm'],
        display: 'python3 -m mlc_llm',
        source: 'python-module',
      },
      {
        command: 'python',
        prefixArgs: ['-m', 'mlc_llm'],
        display: 'python -m mlc_llm',
        source: 'python-module',
      }
    );
  }

  candidates.push({
    command: 'mlc_llm',
    prefixArgs: [],
    display: 'mlc_llm',
    source: 'path',
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}::${candidate.prefixArgs.join(' ')}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const getMlcInstallHint = () =>
  isWindows
    ? 'MLC-binären hittades inte. Appen försöker använda py/python automatiskt. Om problemet kvarstår, sätt MLC_LLM_BIN eller kör electron-noter/scripts/setup-mlc.ps1.'
    : 'MLC-binären hittades inte. Sätt MLC_LLM_BIN eller installera mlc_llm i PATH.';

export const resolveMlcCommand = async (): Promise<ResolvedMlcCommand> => {
  const candidates = await buildCandidates();
  for (const candidate of candidates) {
    if (await probeCandidate(candidate)) {
      return candidate;
    }
  }
  throw new Error(getMlcInstallHint());
};
