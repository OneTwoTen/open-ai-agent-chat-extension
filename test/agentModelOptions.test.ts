import { describe, expect, it } from "vitest";
import { modelOptionsForAgentProvider } from "../webview-ui/panels/agentModelOptions";

describe("modelOptionsForAgentProvider", () => {
  it("uses the selected agent override provider for model suggestions", () => {
    const providers = [
      {
        id: "openai",
        label: "OpenAI",
        exampleModels: ["gpt-4o-mini"],
        capabilities: { tools: true, reasoning: true, images: true, promptCache: "auto" as const },
      },
      {
        id: "anthropic",
        label: "Anthropic",
        exampleModels: ["claude-3-5-sonnet-20241022"],
        capabilities: { tools: true, reasoning: true, images: true, promptCache: "explicit" as const },
      },
    ];

    const options = modelOptionsForAgentProvider({
      providerId: "anthropic",
      activeProviderId: "openai",
      providers,
      modelsByProvider: {
        openai: ["gpt-4o"],
        anthropic: ["claude-3-7-sonnet-latest"],
      },
    });

    expect(options).toEqual(["claude-3-7-sonnet-latest", "claude-3-5-sonnet-20241022"]);
  });
});
