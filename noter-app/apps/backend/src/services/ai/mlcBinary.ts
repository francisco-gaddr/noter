import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

export type ResolvedMlcCommand = {
  command: string;
  prefixArgs: string[];
  display: string;
  source: 'env' | 'py-module' | 'python-module' | 'path' | 'python-scripts';
  envPathEntries?: string[];
};

type Candidate = ResolvedMlcCommand;

const isWindows = process.platform === 'win32';
const pathApi = isWindows ? path.win32 : path.posix;

const dedupe = <T,>(items: T[]) => Array.from(new Set(items));

const listDirectories = async (root: string) => {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => pathApi.join(root, entry.name));
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
    process.env.LOCALAPPDATA ? pathApi.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.APPDATA ? pathApi.join(process.env.APPDATA, 'Python') : '',
    home ? pathApi.join(home, 'AppData', 'Local', 'Programs', 'Python') : '',
    home ? pathApi.join(home, 'AppData', 'Roaming', 'Python') : '',
  ].filter(Boolean);

  const discovered = await Promise.all(candidates.map((root) => listDirectories(root)));
  return dedupe(discovered.flat().map((dir) => pathApi.join(dir, 'Scripts')));
};

const executableExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const getPythonRuntimeDirsFromScripts = (scriptsDir: string) => {
  const pythonDir = pathApi.resolve(scriptsDir, '..');
  const sitePackagesDir = pathApi.join(pythonDir, 'Lib', 'site-packages');
  return [
    scriptsDir,
    pythonDir,
    pathApi.join(pythonDir, 'DLLs'),
    sitePackagesDir,
    pathApi.join(sitePackagesDir, 'tvm'),
    pathApi.join(sitePackagesDir, 'tvm', 'lib'),
    pathApi.join(sitePackagesDir, 'torch', 'lib'),
  ];
};

const buildEnvPathEntries = async () => {
  if (!isWindows) {
    return [];
  }
  const scriptDirs = await listPythonScriptDirs();
  const home = os.homedir();
  const extraLibraryRoots = [
    process.env.CONDA_PREFIX ? pathApi.join(process.env.CONDA_PREFIX, 'Library', 'bin') : '',
    process.env.LOCALAPPDATA ? pathApi.join(process.env.LOCALAPPDATA, 'miniconda3', 'Library', 'bin') : '',
    process.env.LOCALAPPDATA ? pathApi.join(process.env.LOCALAPPDATA, 'anaconda3', 'Library', 'bin') : '',
    home ? pathApi.join(home, 'miniconda3', 'Library', 'bin') : '',
    home ? pathApi.join(home, 'anaconda3', 'Library', 'bin') : '',
    'C:\\pinokio\\bin\\miniconda\\Library\\bin',
  ].filter(Boolean);
  const availableLibraryRoots = (
    await Promise.all(
      extraLibraryRoots.map(async (dirPath) => ((await executableExists(pathApi.join(dirPath, 'zstd.dll'))) ? dirPath : ''))
    )
  ).filter(Boolean);
  return dedupe([
    ...scriptDirs.flatMap((scriptsDir) => getPythonRuntimeDirsFromScripts(scriptsDir)),
    ...availableLibraryRoots,
  ]);
};

const buildCandidateEnv = (candidate: Candidate) => {
  const pathEntries = (candidate.envPathEntries || []).filter(Boolean);
  if (pathEntries.length === 0) {
    return process.env;
  }
  const delimiter = isWindows ? path.win32.delimiter : path.delimiter;
  const currentPath = process.env.Path || process.env.PATH || '';
  const nextPath = dedupe([...pathEntries, ...currentPath.split(delimiter).filter(Boolean)]).join(delimiter);
  return {
    ...process.env,
    PATH: nextPath,
    Path: nextPath,
  };
};

const probeCandidate = async (candidate: Candidate) =>
  new Promise<boolean>((resolve) => {
    let proc;
    try {
      proc = spawn(candidate.command, [...candidate.prefixArgs, '--help'], {
        stdio: 'ignore',
        env: buildCandidateEnv(candidate),
      });
    } catch {
      resolve(false);
      return;
    }
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
  const windowsRuntimeDirs = await buildEnvPathEntries();

  if (envBinary) {
    candidates.push({
      command: envBinary,
      prefixArgs: [],
      display: envBinary,
      source: 'env',
      envPathEntries: windowsRuntimeDirs,
    });
  }

  if (isWindows) {
    candidates.push(
      {
        command: 'py',
        prefixArgs: ['-m', 'mlc_llm'],
        display: 'py -m mlc_llm',
        source: 'py-module',
        envPathEntries: windowsRuntimeDirs,
      },
      {
        command: 'python',
        prefixArgs: ['-m', 'mlc_llm'],
        display: 'python -m mlc_llm',
        source: 'python-module',
        envPathEntries: windowsRuntimeDirs,
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
            envPathEntries: getPythonRuntimeDirsFromScripts(scriptsDir),
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
    envPathEntries: windowsRuntimeDirs,
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
    ? 'MLC-binären eller dess Windows-runtime hittades inte. Appen försöker använda py/python automatiskt. Om problemet kvarstår, kör electron-noter/scripts/setup-mlc.ps1 och verifiera Python Scripts, site-packages, tvm/lib, torch/lib, eventuell Conda Library/bin och VC++-runtime.'
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
