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
  const provider = providers.find((p) => p.id === effectiveProviderId);
  const fetched = modelsByProvider[effectiveProviderId] ?? [];

  return Array.from(new Set([...fetched, ...(provider?.exampleModels ?? [])]));
}
