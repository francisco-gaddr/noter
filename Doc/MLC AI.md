MLC AI
Hugging Face
React Native

Nedan är en komplett, deterministisk implementeringsplan för att:

* Ladda ner GGUF-modeller från Hugging Face
* Konvertera dem korrekt till MLC-format (Detta ska ske autoamtiskt efter nedladdningen i appen och ska göras på en separat tråd för att inte blockera appen, sedan ska MLC-modellen användas i AI-chatten)
* Integrera MLC i en befintlig React Native-app
* Köra lokal inference och chatta stabilt
* Undvika att påverka övriga delar av appen

Detta är en produktionsstruktur, inte en demo.

---

# Översikt: Slutlig arkitektur

Mobilen ska inte kompilera modeller. Appen begär ett kompilerat MLC‑paket, laddar ner det och packar upp det lokalt.

Konvertering sker offline eller via din build‑server och exponeras som nedladdningsbara paket.

```text
React Native UI
↓
ModelManager (JS layer)
↓
Native MLC Module (Swift / Kotlin)
↓
Metal / Vulkan (GPU-fokus)
↓
MLC compiled model files (device storage)
```

GGUF är inputformat. MLC‑format är runtime‑format. Appen hanterar automatisk hämtning av kompilerad MLC‑version och packning efter nedladdning.

---

# Status (app‑implementation)

- [x] MLC‑paket laddas ner och packas upp lokalt
- [x] ModelManager laddar vald modell och återanvänder aktiv modell
- [x] AI‑chatt använder systemprompt och streamar svar
- [x] Fallbacks för saknade native‑moduler och felaktiga paket
- [x] Unit‑tester för AI‑chat
- [x] Unit‑tester för AI‑modeller
- [x] End‑to‑end‑test för AI‑flöde
- [x] API för konvertering och polling av kompilerade paket
- [x] Paketrot valideras efter unzip så att `mlc-chat-config.json` kan hittas även i zippar med extra toppmapp
- [x] Modellval i mobilen verifierar installerat paket före chatt
- [ ] Server/offline‑konvertering med mlc_llm
- [ ] Publicering av kompilerade MLC‑paket

---

# DEL 1 — Server/offline: Konvertera GGUF till MLC-format

MLC kan inte direkt köra GGUF. Den måste konverteras offline och publiceras som ett kompilerat paket som appen kan ladda ner.

Installera MLC toolchain på din dator eller CI-maskin:

```bash
pip install mlc-llm
```

Verifiera:

```bash
mlc_llm --help
```

---

## 1.1 Ladda ner GGUF från Hugging Face

Exempel:

```bash
wget https://huggingface.co/<model>/resolve/main/model.Q4_K_M.gguf
```

---

## 1.2 Konvertera till MLC-format (Körs offline/build-server)

För iOS:

```bash
mlc_llm convert model.Q4_K_M.gguf \
  --quantization q4f16_1 \
  --target iphone \
  -o dist/model-iphone
```

För Android:

```bash
mlc_llm convert model.Q4_K_M.gguf \
  --quantization q4f16_1 \
  --target android \
  -o dist/model-android
```

Detta genererar:

```
dist/model-iphone/
  mlc-chat-config.json
  params_shard_*.bin
```

Detta är det enda mobilappen ska använda.

---

## 1.3 Validera konvertering

Kör lokalt:

```bash
mlc_llm chat dist/model-iphone
```

Om detta fungerar är modellen korrekt byggd.

Om inte, stoppa här.

---

# DEL 2 — Publicera modeller

Du har två alternativ:

### Alternativ A: Hostade kompilerade modeller

Ladda upp dist/model-iphone till:

* S3
* Cloudflare R2
* Egen server

Mobilen laddar ner dessa.

Rekommenderas.

Bas‑URL styrs av `MLC_MODELS_BASE_URL` eller `NEXT_PUBLIC_MLC_MODELS_BASE_URL`.
Filstruktur: `{base}/{platform}/{encode(modelId)}/{QUANT}.zip`

För automatisk konvertering används API:

- `POST /api/ai/models/convert` med `{ modelId, ggufUrl, quant, platform }`
- `GET /api/ai/models/convert?jobId=...` för status och `outputUrl`
- `GET /api/ai/models/health` för att verifiera serverns konverteringsläge före felsökning

Efter nedladdning måste mobilappen alltid verifiera den faktiska paketroten. Vissa zip-filer packas upp som:

```text
Q4_K_M/
  model/
    mlc-chat-config.json
    params_shard_0.bin
```

Appen ska då använda `Q4_K_M/model` som laddningsväg i stället för att felaktigt kasta "Invalid model package".

---

### Alternativ B: Lagra som app asset

Endast för små modeller.

Inte rekommenderat för >2GB.

---

# DEL 3 — React Native Integration

Du har redan modelsökning.

Du ändrar nedladdnings-URL så att den pekar på din kompilerade MLC‑version via `/api/ai/models/compiled?modelId=...&quant=...&platform=...`.

---

## 3.1 Installera filsystem

```bash
npm install react-native-fs
```

---

## 3.2 Download manager

Skapa `ModelDownloader.ts`

```ts
import RNFS from "react-native-fs"

const MODEL_DIR = `${RNFS.DocumentDirectoryPath}/mlc_models`

export async function downloadCompiledModel(url: string, modelName: string) {
  const modelPath = `${MODEL_DIR}/${modelName}`

  await RNFS.mkdir(modelPath)

  const res = await RNFS.downloadFile({
    fromUrl: url,
    toFile: `${modelPath}/model.zip`,
    background: true,
  }).promise

  if (res.statusCode !== 200) {
    throw new Error("Download failed")
  }

  // unzip här
  return modelPath
}
```

Använd react-native-zip-archive för unzip.

---

# DEL 4 — Installera MLC runtime i mobilprojektet

## 4.1 iOS

1. Aktivera New Architecture i RN.
2. Lägg till MLC pod i ios/Podfile:

```ruby
pod 'MLCChat'
```

3. Kör:

```bash
cd ios
pod install
```

4. Aktivera Metal i Xcode capabilities.

---

## 4.2 Android

1. Lägg till MLC AAR i android/app/libs
2. Lägg till i build.gradle:

```gradle
implementation files('libs/mlc-llm.aar')
```

3. Aktivera Vulkan i AndroidManifest.

---

# DEL 5 — Skapa Native Bridge


## Android Kotlin

Skapa `MLCModule.kt`

```kotlin
class MLCModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var engine: ChatModule? = null

  override fun getName() = "MLCModule"

  @ReactMethod
  fun loadModel(path: String) {
    engine = ChatModule(path)
  }

  @ReactMethod
  fun generate(prompt: String, promise: Promise) {
    if (engine == null) {
      promise.reject("no_model", "Model not loaded")
      return
    }

    val result = engine!!.generate(prompt)
    promise.resolve(result)
  }
}
```

---

# DEL 6 — JS Wrapper

Skapa `MLCService.ts`

```ts
import { NativeModules } from "react-native"

const { MLCModule } = NativeModules

export async function loadModel(path: string) {
  await MLCModule.loadModel(path)
}

export async function chat(prompt: string) {
  return await MLCModule.generate(prompt)
}
```

---

# DEL 7 — Model Manager

```ts
class ModelManager {
  private currentPath: string | null = null

  async install(modelUrl, modelName) {
    const path = await downloadCompiledModel(modelUrl, modelName)
    this.currentPath = path
    await loadModel(path)
  }

  async chat(prompt: string) {
    return await chat(prompt)
  }
}

export const modelManager = new ModelManager()
```

All AI-logik isolerad här.

---

# DEL 8 — Chat UI

```ts
const response = await modelManager.chat(userInput)
setMessages([...messages, { role: "assistant", content: response }])
```

---

# Kritiska stabilitetsregler

1. Ladda modell endast en gång (Aktiv modell väljs i inställnignarna)
2. Begränsa context till 2048–4096 (indikera i chatten hur mcyket kontext som använts)
3. Frigör engine när app går i bakgrund
4. Kör inference i native thread


---

# Vanliga orsaker till att det kraschar

* Fel target vid convert
* För stor modell
* Fel kvantisering
* Inte unzippad korrekt
* Fel path skickas till engine
* UI-thread blockeras

---

# Slutresultat

Du får:

* Hugging Face sökning
* Lokal nedladdning
* Lokal GPU-acceleration
* Offline chat
* Ingen server
* Ingen CORS
* Stabil React Native-app
