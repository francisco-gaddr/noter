
## Start the server

[Install](/download) and launch LM Studio.

Then ensure the server is running through the toggle at the top left of the Developer page, or through [lms](/docs/cli) in the terminal:

```bash
lms server start
```
## Status för Noter‑integration

**LM Studio är den valda lokala AI‑vägen för Tauri‑migrationen.** Istället för att porta hela
`mlc_llm`‑subprocessen (nedladdning/konvertering/streaming) — som är komplex, sällananvänd och kräver
en extern binär + GUI för att validera — kör vi lokal AI via LM Studios inbyggda OpenAI‑kompatibla
server. Det är den enklaste vägen: ingen subprocess, ingen nedladdnings‑pipeline, bara HTTP.

Klar:
- **Förstklassig provider `lmstudio`** i `apps/web/services/ai/apiProviders.ts` (desktop/web — på mobil
  når man en LAN‑LM‑Studio via en egen provider, eftersom localhost‑standarden bara är meningsfull där
  LM Studio kör på samma dator): OpenAI‑kompatibel, **noll‑konfig** (standard `http://localhost:1234`),
  utan API‑nyckel (`apiKeyOptional`), och fortfarande överstyrbar för annan port/dator. Väljs i
  AI‑inställningarna under källa = API → provider = "LM Studio (lokal)". Testtäckt.
- Streaming‑chat + modellval via den delade OpenAI‑vägen (samma som OpenAI/Groq/Grok/Hermes).
- Kör i Tauri‑skalet: CSP:n tillåter `http://localhost` (`connect-src http:`), så desktop‑appen når
  den lokala servern direkt.

Återstår:
- Sluttesta mot aktiv LM Studio‑server i en GUI‑session (riktig modell, streaming, tokens/s).
- (Valfritt, senare) Auto‑lista laddade modeller via `GET /api/v1/models` i modellväljaren.
- On‑device `mlc_llm`‑subprocess: skjuten till egen fas, se
  [`migrations/electron-to-tauri-runbook.md`](migrations/electron-to-tauri-runbook.md) och `MLC AI.md`.

By default, the server is available at `http://localhost:1234`.

If you don't have a model downloaded yet, you can download the model:

```bash
lms get ibm/granite-4-micro
```


## API Authentication

By default, the LM Studio API server does **not** require authentication. You can configure the server to require authentication by API token in the [server settings](/docs/developer/core/server/settings) for added security.

To authenticate API requests, generate an API token from the Developer page in LM Studio, and include it in the `Authorization` header of your requests as follows: `Authorization: Bearer $LM_API_TOKEN`. Read more about authentication [here](/docs/developer/core/authentication).


## Chat with a model

Use the chat endpoint to send a message to a model. By default, the model will be automatically loaded if it is not already.

The `/api/v1/chat` endpoint is stateful, which means you do not need to pass the full history in every request. Read more about it [here](/docs/developer/rest/stateful-chats).

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "Write a short haiku about sunrise."
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "Write a short haiku about sunrise."
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro",
          input: "Write a short haiku about sunrise."
        })
      });
      const data = await response.json();
      console.log(data);
```

See the full [chat](/docs/developer/rest/chat) docs for more details.

## Use MCP servers via API


Enable the model interact with ephemeral Model Context Protocol (MCP) servers in `/api/v1/chat` by specifying servers in the `integrations` field.

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro",
          input: "What is the top trending model on hugging face?",
          integrations: [
            {
              type: "ephemeral_mcp",
              server_label: "huggingface",
              server_url: "https://huggingface.co/mcp",
              allowed_tools: ["model_search"]
            }
          ],
          context_length: 8000
        })
      const data = await response.json();
      console.log(data);
```

You can also use locally configured MCP plugins (from your `mcp.json`) via the `integrations` field. Using locally run MCP plugins requires authentication via an API token passed through the `Authorization` header. Read more about authentication [here](/docs/developer/core/authentication).

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "Open lmstudio.ai",
          "integrations": [
            {
              "type": "plugin",
              "id": "mcp/playwright",
              "allowed_tools": ["browser_navigate"]
            }
          ],
          "context_length": 8000
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "Open lmstudio.ai",
          "integrations": [
            {
              "type": "plugin",
              "id": "mcp/playwright",
              "allowed_tools": ["browser_navigate"]
            }
          ],
          "context_length": 8000
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro",
          input: "Open lmstudio.ai",
          integrations: [
            {
              type: "plugin",
              id: "mcp/playwright",
              allowed_tools: ["browser_navigate"]
            }
          ],
          context_length: 8000
        })
      });
      const data = await response.json();
      console.log(data);
```

See the full [chat](/docs/developer/rest/chat) docs for more details.

## Download a model

Use the download endpoint to download models by identifier from the [LM Studio model catalog](https://lmstudio.ai/models), or by Hugging Face model URL.

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/models/download \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro"
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/models/download",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={"model": "ibm/granite-4-micro"}
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/models/download", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro"
        })
      });
      const data = await response.json();
      console.log(data);
```

The response will return a `job_id` that you can use to track download progress.

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl -H "Authorization: Bearer $LM_API_TOKEN" \
        http://localhost:1234/api/v1/models/download/status/{job_id}
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      job_id = "your-job-id"
      response = requests.get(
        f"http://localhost:1234/api/v1/models/download/status/{job_id}",
        headers={"Authorization": f"Bearer {os.environ['LM_API_TOKEN']}"}
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const jobId = "your-job-id";
      const response = await fetch(
        `http://localhost:1234/api/v1/models/download/status/${jobId}`,
        {
          headers: {
            "Authorization": `Bearer ${process.env.LM_API_TOKEN}`
          }
        }
      );
      const data = await response.json();
      console.log(data);
```

See the [download](/docs/developer/rest/download) and [download status](/docs/developer/rest/download-status) docs for more details.



````lms_hstack
`POST /api/v1/chat`

**Request body**
```lms_params
- name: model
  type: string
  optional: false
  description: Unique identifier for the model to use.
- name: input
  type: string | array<object>
  optional: false
  description: Message to send to the model.
  children:
    - name: Input text
      unstyledName: true
      type: string
      description: Text content of the message.
    - name: Input object
      unstyledName: true
      type: object
      description: Object representing a message with additional metadata.
      children:
        - name: Text Input
          type: object
          optional: true
          description: Text input to provide user messages
          children:
            - name: type
              type: '"message"'
              optional: false
              description: Type of input item.
            - name: content
              type: string
              description: Text content of the message.
              optional: false
        - name: Image Input
          type: object
          optional: true
          description: Image input to provide user messages
          children:
            - name: type
              type: '"image"'
              optional: false
              description: Type of input item.
            - name: data_url
              type: string
              description: Image data as a base64-encoded data URL.
              optional: false
- name: system_prompt
  type: string
  optional: true
  description: System message that sets model behavior or instructions.
- name: integrations
  type: array<string | object>
  optional: true
  description: List of integrations (plugins, ephemeral MCP servers, etc...) to enable for this request.
  children:
    - name: Plugin id
      unstyledName: true
      type: string
      description: Unique identifier of a plugin to use. Plugins contain `mcp.json` installed MCP servers (id `mcp/<server_label>`). Shorthand for plugin object with no custom configuration.
    - name: Plugin
      unstyledName: true
      type: object
      description: Specification of a plugin to use. Plugins contain `mcp.json` installed MCP servers (id `mcp/<server_label>`).
      children:
        - name: type
          type: '"plugin"'
          optional: false
          description: Type of integration.
        - name: id
          type: string
          optional: false
          description: Unique identifier of the plugin.
        - name: allowed_tools
          type: array<string>
          optional: true
          description: List of tool names the model can call from this plugin. If not provided, all tools from the plugin are allowed.
    - name: Ephemeral MCP server specification
      unstyledName: true
      type: object
      description: Specification of an ephemeral MCP server. Allows defining MCP servers on-the-fly without needing to pre-configure them in your `mcp.json`.
      children:
        - name: type
          type: '"ephemeral_mcp"'
          optional: false
          description: Type of integration.
        - name: server_label
          type: string
          optional: false
          description: Label to identify the MCP server.
        - name: server_url
          type: string
          optional: false
          description: URL of the MCP server.
        - name: allowed_tools
          type: array<string>
          optional: true
          description: List of tool names the model can call from this server. If not provided, all tools from the server are allowed.
        - name: headers
          type: object
          optional: true
          description: Custom HTTP headers to send with requests to the server.
- name: stream
  type: boolean
  optional: true
  description: Whether to stream partial outputs via SSE. Default `false`. See [streaming events](/docs/developer/rest/streaming-events) for more information.
- name: temperature
  type: number
  optional: true
  description: Randomness in token selection. 0 is deterministic, higher values increase creativity [0,1].
- name: top_p
  type: number
  optional: true
  description: Minimum cumulative probability for the possible next tokens [0,1].
- name: top_k
  type: integer
  optional: true
  description: Limits next token selection to top-k most probable tokens.
- name: min_p
  type: number
  optional: true
  description: Minimum base probability for a token to be selected for output [0,1].
- name: repeat_penalty
  type: number
  optional: true
  description: Penalty for repeating token sequences. 1 is no penalty, higher values discourage repetition.
- name: max_output_tokens
  type: integer
  optional: true
  description: Maximum number of tokens to generate.
- name: reasoning
  type: '"off" | "low" | "medium" | "high" | "on"'
  optional: true
  description: Reasoning setting. Will error if the model being used does not support the reasoning setting using. Defaults to the automatically chosen setting for the model.
- name: context_length
  type: integer
  optional: true
  description: Number of tokens to consider as context. Higher values recommended for MCP usage.
- name: store
  type: boolean
  optional: true
  description: Whether to store the chat. If set, response will return a `"response_id"` field. Default `true`.
- name: previous_response_id
  type: string
  optional: true
  description: Identifier of existing response to append to. Must start with `"resp_"`.
```
:::split:::
```lms_code_snippet
variants:
  Request with MCP:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "Tell me the top trending model on hugging face and navigate to https://lmstudio.ai",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": [
                "model_search"
              ]
            },
            {
              "type": "plugin",
              "id": "mcp/playwright",
              "allowed_tools": [
                "browser_navigate"
              ]
            }
          ],
          "context_length": 8000,
          "temperature": 0
        }'
  Request with Images:
    language: bash
    code: |
      # Image is a small red square encoded as a base64 data URL
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "qwen/qwen3-vl-4b",
          "input": [
            {
              "type": "text",
              "content": "Describe this image in two sentences"
            },
            {
              "type": "image",
              "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC"
            }
          ],
          "context_length": 2048,
          "temperature": 0
        }'
```
````

---

````lms_hstack
**Response fields**
```lms_params
- name: model_instance_id
  type: string
  description: Unique identifier for the loaded model instance that generated the response.
- name: output
  type: array<object>
  description: Array of output items generated. Each item can be one of three types.
  children:
    - name: Message
      unstyledName: true
      type: object
      description: A text message from the model.
      children:
        - name: type
          type: '"message"'
          description: Type of output item.
        - name: content
          type: string
          description: Text content of the message.
    - name: Tool call
      unstyledName: true
      type: object
      description: A tool call made by the model.
      children:
        - name: type
          type: '"tool_call"'
          description: Type of output item.
        - name: tool
          type: string
          description: Name of the tool called.
        - name: arguments
          type: object
          description: Arguments passed to the tool. Can have any keys/values depending on the tool definition.
        - name: output
          type: string
          description: Result returned from the tool.
        - name: provider_info
          type: object
          description: Information about the tool provider.
          children:
            - name: type
              type: '"plugin" | "ephemeral_mcp"'
              description: Provider type.
            - name: plugin_id
              type: string
              optional: true
              description: Identifier of the plugin (when `type` is `"plugin"`).
            - name: server_label
              type: string
              optional: true
              description: Label of the MCP server (when `type` is `"ephemeral_mcp"`).
    - name: Reasoning
      unstyledName: true
      type: object
      description: Reasoning content from the model.
      children:
        - name: type
          type: '"reasoning"'
          description: Type of output item.
        - name: content
          type: string
          description: Text content of the reasoning.
    - name: Invalid tool call
      unstyledName: true
      type: object
      description: An invalid tool call made by the model - due to invalid tool name or tool arguments.
      children:
        - name: type
          type: '"invalid_tool_call"'
          description: Type of output item.
        - name: reason
          type: string
          description: Reason why the tool call was invalid.
        - name: metadata
          type: object
          description: Metadata about the invalid tool call.
          children:
            - name: type
              type: '"invalid_name" | "invalid_arguments"'
              description: Type of error that occurred.
            - name: tool_name
              type: string
              description: Name of the tool that was attempted to be called.
            - name: arguments
              type: object
              optional: true
              description: Arguments that were passed to the tool (only present for `invalid_arguments` errors).
            - name: provider_info
              type: object
              optional: true
              description: Information about the tool provider (only present for `invalid_arguments` errors).
              children:
                - name: type
                  type: '"plugin" | "ephemeral_mcp"'
                  description: Provider type.
                - name: plugin_id
                  type: string
                  optional: true
                  description: Identifier of the plugin (when `type` is `"plugin"`).
                - name: server_label
                  type: string
                  optional: true
                  description: Label of the MCP server (when `type` is `"ephemeral_mcp"`).
- name: stats
  type: object
  description: Token usage and performance metrics.
  children:
    - name: input_tokens
      type: number
      description: Number of input tokens. Includes formatting, tool definitions, and prior messages in the chat.
    - name: total_output_tokens
      type: number
      description: Total number of output tokens generated.
    - name: reasoning_output_tokens
      type: number
      description: Number of tokens used for reasoning.
    - name: tokens_per_second
      type: number
      description: Generation speed in tokens per second.
    - name: time_to_first_token_seconds
      type: number
      description: Time in seconds to generate the first token.
    - name: model_load_time_seconds
      type: number
      optional: true
      description: Time taken to load the model for this request in seconds. Present only if the model was not already loaded.
- name: response_id
  type: string
  optional: true
  description: Identifier of the response for subsequent requests. Starts with `"resp_"`. Present when `store` is `true`.
```
:::split:::
```lms_code_snippet
variants:
  Request with MCP:
    language: json
    code: |
      {
        "model_instance_id": "ibm/granite-4-micro",
        "output": [
          {
            "type": "tool_call",
            "tool": "model_search",
            "arguments": {
              "sort": "trendingScore",
              "query": "",
              "limit": 1
            },
            "output": "...",
            "provider_info": {
              "server_label": "huggingface",
              "type": "ephemeral_mcp"
            }
          },
          {
            "type": "message",
            "content": "..."
          },
          {
            "type": "tool_call",
            "tool": "browser_navigate",
            "arguments": {
              "url": "https://lmstudio.ai"
            },
            "output": "...",
            "provider_info": {
              "plugin_id": "mcp/playwright",
              "type": "plugin"
            }
          },
          {
            "type": "message",
            "content": "**Top Trending Model on Hugging Face** ... Below is a quick snapshot of what’s on the landing page ... more details on the model or LM Studio itself!"
          }
        ],
        "stats": {
          "input_tokens": 646,
          "total_output_tokens": 586,
          "reasoning_output_tokens": 0,
          "tokens_per_second": 29.753900615398926,
          "time_to_first_token_seconds": 1.088,
          "model_load_time_seconds": 2.656
        },
        "response_id": "resp_4ef013eba0def1ed23f19dde72b67974c579113f544086de"
      }
  Request with Images:
    language: json
    code: |
      {
        "model_instance_id": "qwen/qwen3-vl-4b",
        "output": [
          {
            "type": "message",
            "content": "This image is a solid, vibrant red square that fills the entire frame, with no discernible texture, pattern, or other elements. It presents a minimalist, uniform visual field of pure red, evoking a sense of boldness or urgency."
          }
        ],
        "stats": {
          "input_tokens": 17,
          "total_output_tokens": 50,
          "reasoning_output_tokens": 0,
          "tokens_per_second": 51.03762685242662,
          "time_to_first_token_seconds": 0.814
        },
        "response_id": "resp_0182bd7c479d7451f9a35471f9c26b34de87a7255856b9a4"
      }
```
````

````lms_hstack
`GET /api/v1/models`

This endpoint has no request parameters.
:::split:::
```lms_code_snippet
title: Example Request
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/models \
        -H "Authorization: Bearer $LM_API_TOKEN"
```
````

---

````lms_hstack
**Response fields**
```lms_params
- name: models
  type: array
  description: List of available models (both LLMs and embedding models).
  children:
    - name: type
      type: '"llm" | "embedding"'
      description: Type of model.
    - name: publisher
      type: string
      description: Model publisher name.
    - name: key
      type: string
      description: Unique identifier for the model.
    - name: display_name
      type: string
      description: Human-readable model name.
    - name: architecture
      type: string | null
      optional: true
      description: Model architecture (e.g., "llama", "mistral"). Absent for embedding models.
    - name: quantization
      type: object | null
      description: Quantization information for the model.
      children:
        - name: name
          type: string | null
          description: Quantization method name.
        - name: bits_per_weight
          type: number | null
          description: Bits per weight for the quantization.
    - name: size_bytes
      type: number
      description: Size of the model in bytes.
    - name: params_string
      type: string | null
      description: Human-readable parameter count (e.g., "7B", "13B").
    - name: loaded_instances
      type: array
      description: List of currently loaded instances of this model.
      children:
        - name: id
          type: string
          description: Unique identifier for the loaded model instance.
        - name: config
          type: object
          description: Configuration for the loaded instance.
          children:
            - name: context_length
              type: number
              description: The maximum context length for the model in number of tokens.
            - name: eval_batch_size
              type: number
              optional: true
              description: Number of input tokens to process together in a single batch during evaluation. Absent for embedding models.
            - name: flash_attention
              type: boolean
              optional: true
              description: Whether Flash Attention is enabled for optimized attention computation. Absent for embedding models.
            - name: num_experts
              type: number
              optional: true
              description: Number of experts for MoE (Mixture of Experts) models. Absent for embedding models.
            - name: offload_kv_cache_to_gpu
              type: boolean
              optional: true
              description: Whether KV cache is offloaded to GPU memory. Absent for embedding models.
    - name: max_context_length
      type: number
      description: Maximum context length supported by the model in number of tokens.
    - name: format
      type: '"gguf" | "mlx" | null'
      description: Model file format.
    - name: capabilities
      type: object
      optional: true
      description: Model capabilities. Absent for embedding models.
      children:
        - name: vision
          type: boolean
          description: Whether the model supports vision/image inputs.
        - name: trained_for_tool_use
          type: boolean
          description: Whether the model was trained for tool/function calling.
    - name: description
      type: string | null
      optional: true
      description: Model description. Absent for embedding models.
```
:::split:::
```lms_code_snippet
title: Response
variants:
  json:
    language: json
    code: |
      {
        "models": [
          {
            "type": "llm",
            "publisher": "lmstudio-community",
            "key": "gemma-3-270m-it-qat",
            "display_name": "Gemma 3 270m Instruct Qat",
            "architecture": "gemma3",
            "quantization": {
              "name": "Q4_0",
              "bits_per_weight": 4
            },
            "size_bytes": 241410208,
            "params_string": "270M",
            "loaded_instances": [
              {
                "id": "gemma-3-270m-it-qat",
                "config": {
                  "context_length": 4096,
                  "eval_batch_size": 512,
                  "flash_attention": false,
                  "num_experts": 0,
                  "offload_kv_cache_to_gpu": true
                }
              }
            ],
            "max_context_length": 32768,
            "format": "gguf",
            "capabilities": {
              "vision": false,
              "trained_for_tool_use": false
            },
            "description": null
          },
          {
            "type": "embedding",
            "publisher": "gaianet",
            "key": "text-embedding-nomic-embed-text-v1.5-embedding",
            "display_name": "Nomic Embed Text v1.5",
            "quantization": {
              "name": "F16",
              "bits_per_weight": 16
            },
            "size_bytes": 274290560,
            "params_string": null,
            "loaded_instances": [],
            "max_context_length": 2048,
            "format": "gguf"
          }
        ]
      }
```
````
````lms_hstack
`POST /api/v1/models/load`

**Request body**
```lms_params
- name: model
  type: string
  optional: false
  description: Unique identifier for the model to load. Can be an LLM or embedding model.
- name: context_length
  type: number
  optional: true
  description: Maximum number of tokens that the model will consider.
- name: eval_batch_size
  type: number
  optional: true
  description: Number of input tokens to process together in a single batch during evaluation. Will only have an effect on LLMs loaded by LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
- name: flash_attention
  type: boolean
  optional: true
  description: Whether to optimize attention computation. Can decrease memory usage and improved generation speed. Will only have an effect on LLMs loaded by LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
- name: num_experts
  type: number
  optional: true
  description: Number of expert to use during inference for MoE (Mixture of Experts) models. Will only have an effect on MoE LLMs loaded by LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
- name: offload_kv_cache_to_gpu
  type: boolean
  optional: true
  description: Whether KV cache is offloaded to GPU memory. If false, KV cache is stored in CPU memory/RAM. Will only have an effect on LLMs loaded by LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
- name: echo_load_config
  type: boolean
  optional: true
  description: If true, echoes the final load configuration in the response under `"load_config"`. Default `false`.
```
:::split:::
```lms_code_snippet
title: Example Request
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/models/load \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "openai/gpt-oss-20b",
          "context_length": 16384,
          "flash_attention": true,
          "echo_load_config": true,
        }'
```
````

---

````lms_hstack
**Response fields**
```lms_params
- name: type
  type: '"llm" | "embedding"'
  description: Type of the loaded model.
- name: instance_id
  type: string
  description: Unique identifier for the loaded model instance.
- name: load_time_seconds
  type: number
  description: Time taken to load the model in seconds.
- name: status
  type: '"loaded"'
  description: Load status.
- name: load_config
  type: object
  optional: true
  description: The final configuration applied to the loaded model. This may include settings that were not specified in the request. Included only when `"echo_load_config"` is `true` in the request.
  children:
    - name: LLM load config
      unstyledName: true
      type: object
      description: Configuration parameters specific to LLM models. `load_config` will be this type when `"type"` is `"llm"`. Only parameters that applied to the load will be present.
      children:
        - name: context_length
          type: number
          optional: false
          description: Maximum number of tokens that the model will consider.
        - name: eval_batch_size
          type: number
          optional: true
          description: Number of input tokens to process together in a single batch during evaluation. Only present for models loaded with LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
        - name: flash_attention
          type: boolean
          optional: true
          description: Whether Flash Attention is enabled for optimized attention computation. Only present for models loaded with LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
        - name: num_experts
          type: number
          optional: true
          description: Number of experts for MoE (Mixture of Experts) models. Only present for MoE models loaded with LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
        - name: offload_kv_cache_to_gpu
          type: boolean
          optional: true
          description: Whether KV cache is offloaded to GPU memory. Only present for models loaded with LM Studio's [llama.cpp](https://github.com/ggml-org/llama.cpp)-based engine.
    - name: Embedding model load config
      unstyledName: true
      type: object
      description: Configuration parameters specific to embedding models. `load_config` will be this type when `"type"` is `"embedding"`. Only parameters that applied to the load will be present.
      children:
        - name: context_length
          type: number
          optional: false
          description: Maximum number of tokens that the model will consider.
```
:::split:::
```lms_code_snippet
title: Response
variants:
  json:
    language: json
    code: |
      {
        "type": "llm",
        "instance_id": "openai/gpt-oss-20b",
        "load_time_seconds": 9.099,
        "status": "loaded",
        "load_config": {
          "context_length": 16384,
          "eval_batch_size": 512,
          "flash_attention": true,
          "offload_kv_cache_to_gpu": true,
          "num_experts": 4
        }
      }
```
````
##### Requires [LM Studio 0.4.0](/download) or newer.

LM Studio supports Model Context Protocol (MCP) usage via API. MCP allows models to interact with external tools and services through standardized servers.

## How it works

MCP servers provide tools that models can call during chat requests. You can enable MCP servers in two ways: as ephemeral servers defined per-request, or as pre-configured servers in your `mcp.json` file.


## Ephemeral vs mcp.json servers

<table class="flexible-cols">
  <thead>
    <tr>
      <th>Feature</th>
      <th>Ephemeral</th>
      <th>mcp.json</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>How to specify in request</td>
      <td><code>integrations</code> -> <code>"type": "ephemeral_mcp"</code></td>
      <td><code>integrations</code> -> <code>"type": "plugin"</code></td>
    </tr>
    <tr>
      <td>Configuration</td>
      <td>Only defined per-request</td>
      <td>Pre-configured in <code>mcp.json</code></td>
    </tr>
    <tr>
      <td>Use case</td>
      <td>One-off requests, remote MCP tool execution</td>
      <td>MCP servers that require <code>command</code>, frequently used servers</td>
    </tr>
    <tr>
      <td>Server ID</td>
      <td>Specified via <code>server_label</code> in integration</td>
      <td>Specified via <code>id</code> (e.g., <code>mcp/playwright</code>) in integration</td>
    </tr>
    <tr>
      <td>Custom headers</td>
      <td>Supported via <code>headers</code> field</td>
      <td>Configured in <code>mcp.json</code></td>
    </tr>
  </tbody>
</table>

## Ephemeral MCP servers

Ephemeral MCP servers are defined on-the-fly in each request. This is useful for testing or when you don't want to pre-configure servers.

```lms_info
Ephemeral MCP servers require the "Allow per-request MCPs" setting to be enabled in [Server Settings](/docs/developer/core/server/settings).
```

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        });
      const data = await response.json();
      console.log(data);
```

The model can now call tools from the specified MCP server:

```lms_code_snippet
variants:
  response:
    language: json
    code: |
      {
        "model_instance_id": "ibm/granite-4-micro",
        "output": [
          {
            "type": "reasoning",
            "content": "..."
          },
          {
            "type": "message",
            "content": "..."
          },
          {
            "type": "tool_call",
            "tool": "model_search",
            "arguments": {
              "sort": "trendingScore",
              "limit": 1
            },
            "output": "...",
            "provider_info": {
              "server_label": "huggingface",
              "type": "ephemeral_mcp"
            }
          },
          {
            "type": "reasoning",
            "content": "\n"
          },
          {
            "type": "message",
            "content": "The top trending model is ..."
          }
        ],
        "stats": {
          "input_tokens": 419,
          "total_output_tokens": 362,
          "reasoning_output_tokens": 195,
          "tokens_per_second": 27.620159487314744,
          "time_to_first_token_seconds": 1.437
        },
        "response_id": "resp_7c1a08e3d6e279efcfecb02df9de7cbd316e93422d0bb5cb"
      }
```

## MCP servers from mcp.json

MCP servers can be pre-configured in your `mcp.json` file. This is the recommended approach for using MCP servers that take actions on your computer (like [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)) and servers that you use frequently.

```lms_info
MCP servers from mcp.json require the "Allow calling servers from mcp.json" setting to be enabled in [Server Settings](/docs/developer/core/server/settings).
```

<img src="/assets/docs/mcp-editor.png" style="" data-caption="Editing mcp.json in LM Studio" />


```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "Open lmstudio.ai",
          "integrations": ["mcp/playwright"],
          "context_length": 8000,
          "temperature": 0
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "Open lmstudio.ai",
          "integrations": ["mcp/playwright"],
          "context_length": 8000,
          "temperature": 0
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro",
          input: "Open lmstudio.ai",
          integrations: ["mcp/playwright"],
          context_length: 8000,
          temperature: 0
        })
      });
      const data = await response.json();
      console.log(data);
```

The response includes tool calls from the configured MCP server:

```lms_code_snippet
variants:
  response:
    language: json
    code: |
      {
        "model_instance_id": "ibm/granite-4-micro",
        "output": [
          {
            "type": "reasoning",
            "content": "..."
          },
          {
            "type": "message",
            "content": "..."
          },
          {
            "type": "tool_call",
            "tool": "browser_navigate",
            "arguments": {
              "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            },
            "output": "...",
            "provider_info": {
              "plugin_id": "mcp/playwright",
              "type": "plugin"
            }
          },
          {
            "type": "reasoning",
            "content": "..."
          },
          {
            "type": "message",
            "content": "The YouTube video page for ..."
          }
        ],
        "stats": {
          "input_tokens": 2614,
          "total_output_tokens": 594,
          "reasoning_output_tokens": 389,
          "tokens_per_second": 26.293245822877495,
          "time_to_first_token_seconds": 0.154
        },
        "response_id": "resp_cdac6a9b5e2a40027112e441ce6189db18c9040f96736407"
      }
```

## Restricting tool access

For both ephemeral and mcp.json servers, you can limit which tools the model can call using the `allowed_tools` field. This is useful if you do not want certain tools from an MCP server to be used, and can speed up prompt processing due to the model receiving fewer tool definitions.

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "What is the top trending model on hugging face?",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"]
            }
          ],
          "context_length": 8000
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro",
          input: "What is the top trending model on hugging face?",
          integrations: [
            {
              type: "ephemeral_mcp",
              server_label: "huggingface",
              server_url: "https://huggingface.co/mcp",
              allowed_tools: ["model_search"]
            }
          ],
          context_length: 8000
        })
      });
      const data = await response.json();
      console.log(data);
```

If `allowed_tools` is not provided, all tools from the server are available to the model.

## Custom headers for ephemeral servers

When using ephemeral MCP servers that require authentication, you can pass custom headers:

```lms_code_snippet
variants:
  curl:
    language: bash
    code: |
      curl http://localhost:1234/api/v1/chat \
        -H "Authorization: Bearer $LM_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
          "model": "ibm/granite-4-micro",
          "input": "Give me details about my SUPER-SECRET-PRIVATE Hugging face model",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"],
              "headers": {
                "Authorization": "Bearer <YOUR_HF_TOKEN>"
              }
            }
          ],
          "context_length": 8000
        }'
  Python:
    language: python
    code: |
      import os
      import requests
      import json

      response = requests.post(
        "http://localhost:1234/api/v1/chat",
        headers={
          "Authorization": f"Bearer {os.environ['LM_API_TOKEN']}",
          "Content-Type": "application/json"
        },
        json={
          "model": "ibm/granite-4-micro",
          "input": "Give me details about my SUPER-SECRET-PRIVATE Hugging face model",
          "integrations": [
            {
              "type": "ephemeral_mcp",
              "server_label": "huggingface",
              "server_url": "https://huggingface.co/mcp",
              "allowed_tools": ["model_search"],
              "headers": {
                "Authorization": "Bearer <YOUR_HF_TOKEN>"
              }
            }
          ],
          "context_length": 8000
        }
      )
      print(json.dumps(response.json(), indent=2))
  TypeScript:
    language: typescript
    code: |
      const response = await fetch("http://localhost:1234/api/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.LM_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "ibm/granite-4-micro",
          input: "Give me details about my SUPER-SECRET-PRIVATE Hugging face model",
          integrations: [
            {
              type: "ephemeral_mcp",
              server_label: "huggingface",
              server_url: "https://huggingface.co/mcp",
              allowed_tools: ["model_search"],
              headers: {
                Authorization: "Bearer <YOUR_HF_TOKEN>"
              }
            }
          ],
          context_length: 8000
        })
      const data = await response.json();
      console.log(data);
```

