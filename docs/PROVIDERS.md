# Providers

Set the active provider with `aiAgentChat.provider`, or from the dropdown in the chat header. Set the model with `aiAgentChat.model` (empty = the provider's default). API keys are stored via **AI Agent: Set Provider API Key** in VS Code SecretStorage.

The model box is an autocomplete that lists **all models the provider currently exposes**, fetched live from its API (OpenAI/compatible `/models`, Anthropic `/v1/models`, Google, Cohere, Ollama `/api/tags`). Use the refresh button to refetch. Providers without a listing endpoint (Azure, Bedrock, Vertex, Perplexity) fall back to the built-in example models. Fetching needs the provider's API key to be set first.

| Provider id | Label | Package | Credential |
| --- | --- | --- | --- |
| `openai` | OpenAI | `@ai-sdk/openai` | API key (+ optional `baseUrl`) |
| `anthropic` | Anthropic | `@ai-sdk/anthropic` | API key |
| `google` | Google Gemini | `@ai-sdk/google` | API key |
| `vertex` | Google Vertex AI | `@ai-sdk/google-vertex` | GCP ADC + `vertex.project`/`vertex.location` |
| `azure` | Azure OpenAI | `@ai-sdk/azure` | API key + `azure.resourceName` |
| `bedrock` | Amazon Bedrock | `@ai-sdk/amazon-bedrock` | `AWS_*` env vars + `bedrock.region` |
| `mistral` | Mistral | `@ai-sdk/mistral` | API key |
| `cohere` | Cohere | `@ai-sdk/cohere` | API key |
| `groq` | Groq | `@ai-sdk/groq` | API key |
| `deepseek` | DeepSeek | `@ai-sdk/deepseek` | API key |
| `fireworks` | Fireworks | `@ai-sdk/fireworks` | API key |
| `togetherai` | Together AI | `@ai-sdk/togetherai` | API key |
| `xai` | xAI Grok | `@ai-sdk/xai` | API key |
| `cerebras` | Cerebras | `@ai-sdk/cerebras` | API key |
| `perplexity` | Perplexity | `@ai-sdk/perplexity` | API key |
| `ollama` | Ollama (local) | `@ai-sdk/openai-compatible` | none (`baseUrl`, default `http://localhost:11434/v1`) |
| `custom` | Custom OpenAI-compatible | `@ai-sdk/openai-compatible` | optional key + `baseUrl` |

## Notes per provider

- **OpenAI / Azure / Ollama / Custom** honour `aiAgentChat.baseUrl` for self-hosted or proxy endpoints.
- **Bedrock** reads `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN` from the environment, plus `aiAgentChat.bedrock.region`.
- **Vertex** uses Google Application Default Credentials; set `aiAgentChat.vertex.project` and `aiAgentChat.vertex.location`.
- **Ollama** needs a tool-capable model (e.g. `qwen2.5-coder`, `llama3.1`) for the agent loop to call tools.

## Embeddings (Tier 3 search)

Embeddings use a separate provider/model so you can keep cheap local or OpenAI embeddings regardless of your chat provider:

- `aiAgentChat.embeddings.provider` (default `openai`)
- `aiAgentChat.embeddings.model` (default: provider's embedding model, e.g. `text-embedding-3-small`)

Providers that expose `textEmbeddingModel` include OpenAI, Google, Mistral, Cohere, Azure, and Ollama/Custom (OpenAI-compatible). If a provider lacks embeddings, point `embeddings.provider` at one that has them.

## Adding another provider

1. `npm install @ai-sdk/<name>`.
2. Add an entry to `PROVIDERS` in `src/providers/catalog.ts`.
3. Add a `case` in `buildProvider` in `src/providers/registry.ts` that calls the package's `create<Name>` factory.
4. Add the id to the `aiAgentChat.provider` enum in `package.json`.
