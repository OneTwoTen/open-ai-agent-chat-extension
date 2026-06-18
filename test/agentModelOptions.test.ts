import { describe, expect, it } from "vitest";
import {
  modelOptionsForAgentProvider,
  modelOptionsForProvider,
} from "../webview-ui/panels/agentModelOptions";

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

  it("returns suggestions for an explicit settings provider", () => {
    const providers = [
      {
        id: "openai",
        label: "OpenAI",
        requiresApiKey: true,
        supportsBaseUrl: true,
        exampleModels: ["gpt-4o-mini"],
        capabilities: { tools: true, reasoning: true, images: true, promptCache: "auto" as const },
      },
      {
        id: "google",
        label: "Google Gemini",
        requiresApiKey: true,
        supportsBaseUrl: false,
        exampleModels: ["gemini-2.0-flash"],
        capabilities: { tools: true, reasoning: true, images: true, promptCache: "auto" as const },
      },
    ];

    const options = modelOptionsForProvider({
      providerId: "google",
      providers,
      modelsByProvider: {
        openai: ["gpt-4o"],
        google: ["gemini-1.5-pro", "gemini-2.0-flash"],
      },
    });

    expect(options).toEqual(["gemini-1.5-pro", "gemini-2.0-flash"]);
  });
});
