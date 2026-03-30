här kommer en komplett, steg-för-steg guide för att ta din befintliga Next.js-app och göra den till en Electron-app med full llama.cpp-native GPU-integration, Hugging Face-modellnedladdning med MLC-konvertering, real-time chat streaming och stabil fallback/felhantering. Jag lägger det i ett tydligt arbetsflöde så du kan följa det ordentligt.

---

# Status (Electron)

- [x] Skapad Electron-app i `f:\Tech\Projekt\Noter\electron-noter`
- [x] main.js + preload.js med IPC och säker contextBridge
- [x] Nedladdning + MLC-konvertering via `mlc_llm` (local cache)
- [x] Lokal MLC-chat via IPC med streaming
- [x] Dev- och build-script för Electron + export av Next.js
- [x] Enhetstester för MLC‑hjälpfunktioner
- [x] E2E‑test för Electron preload‑bridge
- [x] E2E‑test för mockad nedladdning + chat via IPC
- [x] GPU‑fallback (automatiskt CPU vid CUDA‑fel)
- [x] Dev‑rendering med retry/fallback för att undvika vit app
- [x] Electron-chat returnerar faktisk assistenttext tillbaka till chattkedjan utan DB-workaround
- [x] Endast stdout streamas som chat-token; stderr används för felhantering
- [x] AI-inställningar har global backend-sync-toggle för krypterad lokal-only historik
- [x] Tool-use har read-only/full access-lägen i UI och runtime
- [x] Promptprofiler och sessionsinsikter visas i AI-inställningarna
- [x] Robust MLC-kommandoupplösning med fallback till `py -m mlc_llm` / `python -m mlc_llm`
- [ ] End‑to‑end‑test med riktig modellnedladdning och chat

## Nya AI-utökningar

- **Global AI-sync-toggle**
  - När användaren stänger av sync skickar Electron-renderern inte AI-chattar eller AI-projekt till backend.
  - Historik fortsätter lagras krypterat lokalt i klientens lokala datalager.
  - Detta är särskilt viktigt för användare som vill ha ren device-local AI-historik.
- **Promptprofiler**
  - AI-inställningarna låter nu användaren välja promptprofil ovanpå vanlig systemprompt.
  - Profilerna är avsedda för balans, research, utförande och kortfattade svar.
- **Tool-use access mode**
  - `Endast läsning` blockerar skrivande tool-calls och skrivande MCP-anrop.
  - `Full åtkomst` tillåter hela verktygsflödet.
  - Blockeringen sker i runtime, inte bara i UI, så modellen kan inte kringgå policyn.
- **Sessionsinsikter**
  - Electron-webbklienten visar aktiv provider, modell, sync-läge, promptprofil, tool-läge och aktiva MCP-tjänster.
  - Detta förbättrar debugging, support och verifiering vid release.
- **GGUF-pipeline och diagnos**
  - Electron och backend försöker nu inte bara `mlc_llm` i PATH utan kan falla tillbaka till `py -m mlc_llm` och `python -m mlc_llm`.
  - AI-inställningarna visar nu GGUF/MLC-diagnostik med aktiv kommandoupplösning och hint om installation saknas.
  - Efter nedladdning och konvertering aktiveras modellen automatiskt i Electron-klienten.
  - Backendens compiled-endpoint rapporterar nu även om ett färdigt MLC-zip redan finns, så mobilappen kan hoppa över onödig konvertering och ladda ned paketet direkt.

---

# Windows: Installera MLC + PATH (snabbt)

Kör detta från `electron-noter`:

```
powershell -ExecutionPolicy Bypass -File .\scripts\setup-mlc.ps1
```

Det installerar/uppdaterar `mlc-llm` med pip, lägger till korrekt `Scripts`‑mapp i User PATH och verifierar `mlc_llm`.

Steg-för-steg: Konvertera Next.js → Electron med native llama.cpp AI
1. Skapa en ny Electron-projektmapp

Håll ditt gamla Next.js-projekt orört.

Skapa en ny mapp bredvid ditt gamla Next.js-projekt (fast med namnet "electron-noter"):

mkdir electron-noter
cd electron-noter

Initiera Node.js:

npm init -y

Installera Electron:

npm install --save-dev electron electron-builder

Installera andra nödvändiga dependencies (Playwright/Jest för tester):

npm install --save-dev electron electron-builder jest @playwright/test
2. Koppla Next.js-koden (ingen duplicering)

Electron startar Next.js från `noter-app/apps/web` i dev-läge och använder exporterat `out/` i production.

Kontrollera att webappen har scriptet `export`: `next export -o out`.

3. Förbered Electron-entrypoint (main.js)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs-extra');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Kör Next.js dev-server om utveckling
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3001/app/');
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'app', 'index.html'));
  }
}

app.whenReady().then(createWindow);

// Stabil IPC för llama.cpp
ipcMain.handle('run-llama', async (event, { prompt, modelPath }) => {
  return new Promise((resolve, reject) => {
    const llamaExe = path.join(__dirname, 'llama', 'main.exe');

    if (!fs.existsSync(modelPath)) {
      return reject(new Error('Model file does not exist'));
    }

    const child = spawn(llamaExe, [
      '-m', modelPath,
      '-p', prompt,
      '--gpu', '0',        // Använder GPU 0
      '--threads', '8',
      '--temp', '0.7'
    ]);

    let fullOutput = '';
    child.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      event.sender.send('llama-token', text);
    });

    child.stderr.on('data', (data) => {
      console.error('LLAMA ERR:', data.toString());
    });

    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`llama.cpp exited with ${code}`));
      resolve(fullOutput);
    });

    child.on('error', (err) => reject(err));
  });
});
4. Skapa preload.js för säker IPC
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('llama', {
  run: (options) => ipcRenderer.invoke('run-llama', options),
  onToken: (callback) => ipcRenderer.on('llama-token', (event, token) => callback(token))
});
5. Anpassa frontend (React/Next.js) för real-time AI-chat
import { useEffect, useState } from 'react';

export default function Chat() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');

  useEffect(() => {
    window.llama.onToken((token) => {
      setOutput((prev) => prev + token);
    });
  }, []);

  const runLlama = async () => {
    setOutput('');
    await window.llama.run({
      prompt,
      modelPath: 'llama/models/7B.ggmlv3.q4_0.bin'
    });
  };

  return (
    <div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button onClick={runLlama}>Run AI</button>
      <pre>{output}</pre>
    </div>
  );
}
6. Hugging Face-modeller → MLC-format automatiskt (lokalt)

Installera Hugging Face CLI:

pip install huggingface_hub

Skapa Node.js-script för nedladdning + konvertering:

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

async function downloadAndConvert(modelId) {
  const outDir = path.join(__dirname, 'llama', 'models', modelId);
  fs.ensureDirSync(outDir);

  // Hugging Face nedladdning
  await exec(`huggingface-cli download ${modelId} --cache-dir ${outDir}`);

  // Konvertera till MLC-format via llama.cpp / mlc
  const convertedModel = path.join(outDir, 'model.mlcm');
  await exec(`python convert_to_mlc.py --input ${outDir} --output ${convertedModel}`);

  return convertedModel;
}

module.exports = { downloadAndConvert };

Du kan koppla detta script till Electron via IPC så att användaren kan klicka “Download Model” direkt från appen.

7. GPU och prestanda

Använd --gpu 0 och 8–16 trådar för CPU fallback.

Optimera precision: 4-bit (q4_0) eller 8-bit (q8_0) modeller för balans mellan hastighet och minnesanvändning.

Stabil streaming: skicka varje token via IPC till renderer.

Felhantering: kolla om modellfil finns, fånga child_process error events, ge fallback till CPU om GPU misslyckas.

8. Build och distribution

Bygg Next.js för produktion:

npm run build
npm run export

Lägg till i package.json:

"main": "main.js",
"scripts": {
  "electron": "electron .",
  "build-electron": "electron-builder"
}

Kör Electron i dev:

npm run electron

Skapa Windows .exe:

npm run build-electron
9. Fallback och stabilitet

GPU misslyckas → fallback CPU: implementera try/catch runt --gpu flag.

Timeouts: sätt max timeout på child_process om modellen hänger.

Streaming crash recovery: buffra output i minnet tills full token finns, om Electron renderer kraschar, reconnect.

Model integrity: verifiera att MLC-modeller är kompletta innan körning.

10. Resultat

Electron-app med lokal Next.js frontend.

Native llama.cpp AI på GPU/CPU.

Hugging Face-modeller automatiskt nedladdade + konverterade till MLC.

Real-time token streaming i chatten.

Stabilitet, fallback och felhantering inbyggt.
