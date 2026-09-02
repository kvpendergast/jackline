import type { AgentPublicSkill } from "../types/agent.js";

export type AgentCardInput = {
  handle: string;
  displayName: string;
  description: string | null;
  publicSkills: AgentPublicSkill[];
  knocksEnabled: boolean;
  publicBaseUrl: string;
  status: "draft" | "published" | "paused";
};

export function agentCardUrl(publicBaseUrl: string, handle: string): string {
  const base = publicBaseUrl.replace(/\/$/, "");
  return `${base}/agents/${handle}/.well-known/agent-card.json`;
}

export function a2aEndpointUrl(publicBaseUrl: string, handle: string): string {
  const base = publicBaseUrl.replace(/\/$/, "");
  return `${base}/a2a/${handle}`;
}

export function buildAgentCard(input: AgentCardInput): Record<string, unknown> {
  const cardUrl = agentCardUrl(input.publicBaseUrl, input.handle);
  const a2aUrl = a2aEndpointUrl(input.publicBaseUrl, input.handle);

  return {
    name: input.displayName,
    description: input.description ?? "",
    url: cardUrl,
    protocolVersion: "1.0",
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: {
      streaming: false,
      extendedAgentCard: true,
    },
    skills: input.publicSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [],
    })),
    supportedInterfaces: [
      {
        url: a2aUrl,
        protocolBinding: "https://a2a-protocol.org/v1.0/bindings/json-rpc",
      },
    ],
    securitySchemes: {
      jacklinePeer: {
        type: "http",
        scheme: "bearer",
        description: "Trust-grant credential issued out-of-band after knock approval",
      },
    },
    security: [{ jacklinePeer: [] }],
    extensions: [
      {
        uri: "https://jackline.dev/ext/trust/v1",
        required: false,
        params: {
          knocksEnabled: input.knocksEnabled,
          knockPath: "jackline.trust.request",
          status: input.status,
        },
      },
    ],
  };
}

export type A2aAuthDecision =
  | { action: "allow"; trustGrantId: string }
  | { action: "knock_only" }
  | { action: "deny"; reason: string };

export type A2aAuthInput = {
  agentStatus: "draft" | "published" | "paused";
  knocksEnabled: boolean;
  method: string;
  hasValidGrant: boolean;
  trustGrantId?: string;
  isKnockIntent: boolean;
};

/**
 * Cheap auth-before-work decision for A2A ingress.
 * Knocks are the only unauthenticated work besides discovery/card fetch.
 */
export function decideA2aAuth(input: A2aAuthInput): A2aAuthDecision {
  if (input.agentStatus === "paused") {
    return { action: "deny", reason: "Agent is paused" };
  }
  if (input.agentStatus === "draft") {
    return { action: "deny", reason: "Agent is not published" };
  }

  if (input.hasValidGrant && input.trustGrantId) {
    return { action: "allow", trustGrantId: input.trustGrantId };
  }

  if (input.isKnockIntent && input.method === "message/send") {
    if (!input.knocksEnabled) {
      return { action: "deny", reason: "Knocks are disabled for this agent" };
    }
    return { action: "knock_only" };
  }

  return { action: "deny", reason: "Authentication required" };
}
