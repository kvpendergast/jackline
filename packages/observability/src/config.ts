import { err, ok, type Result } from "neverthrow";
import { SetupError, type Env } from "@jackline/shared";

export type OtelConfig = {
  exportEnabled: boolean;
  serviceName: string;
  otlpEndpoint?: string;
  samplerRatio: number;
};

export type ResolveOtelConfigInput = {
  serviceName: string;
  otlpEndpoint?: string | undefined;
  samplerArg?: string | undefined;
};

export function otelConfigFromEnv(
  env: Pick<Env, "OTEL_EXPORTER_OTLP_ENDPOINT" | "OTEL_TRACES_SAMPLER_ARG">,
  serviceName: string,
): Result<OtelConfig, SetupError> {
  return resolveOtelConfig({
    serviceName,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    samplerArg: env.OTEL_TRACES_SAMPLER_ARG,
  });
}

function parseSamplerRatio(raw: string | undefined): Result<number, SetupError> {
  if (raw == null || raw.trim() === "") {
    return ok(1);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return err(
      new SetupError(
        "OTEL_TRACES_SAMPLER_ARG must be a number between 0 and 1 when set",
      ),
    );
  }
  return ok(parsed);
}

/** Resolve OTEL export settings. Export is enabled only when an OTLP endpoint URL is set. */
export function resolveOtelConfig(
  input: ResolveOtelConfigInput,
): Result<OtelConfig, SetupError> {
  const endpoint = input.otlpEndpoint?.trim();
  const samplerResult = parseSamplerRatio(input.samplerArg);
  if (samplerResult.isErr()) {
    return err(samplerResult.error);
  }

  if (!endpoint) {
    return ok({
      exportEnabled: false,
      serviceName: input.serviceName,
      samplerRatio: samplerResult.value,
    });
  }

  try {
    new URL(endpoint);
  } catch {
    return err(new SetupError("OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL"));
  }

  return ok({
    exportEnabled: true,
    serviceName: input.serviceName,
    otlpEndpoint: endpoint,
    samplerRatio: samplerResult.value,
  });
}
