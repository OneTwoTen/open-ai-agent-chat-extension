import { ProviderInfo } from "../../src/shared/protocol";

export function modelOptionsForAgentProvider({
  providerId,
  activeProviderId,
  providers,
  modelsByProvider,
}: {
  providerId?: string;
  activeProviderId: string;
  providers: ProviderInfo[];
  modelsByProvider: Record<string, string[]>;
}): string[] {
  const effectiveProviderId = providerId || activeProviderId;
  return modelOptionsForProvider({ providerId: effectiveProviderId, providers, modelsByProvider });
}

export function modelOptionsForProvider({
  providerId,
  providers,
  modelsByProvider,
}: {
  providerId: string;
  providers: ProviderInfo[];
  modelsByProvider: Record<string, string[]>;
}): string[] {
  const provider = providers.find((p) => p.id === providerId);
  const fetched = modelsByProvider[providerId] ?? [];

  return Array.from(new Set([...fetched, ...(provider?.exampleModels ?? [])]));
}
