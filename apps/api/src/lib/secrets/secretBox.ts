import { createSecretBox, type SecretBox } from "@jackline/crypto";
import {
  EncryptionError,
  getConfig,
  NotImplementedError,
  SetupError,
} from "@jackline/shared";
import { err, ok, type Result } from "neverthrow";

const LOCAL_KEY_VERSION = 1;

let cached: SecretBox | undefined;

export function getSecretBox(): Result<
  SecretBox,
  SetupError | EncryptionError | NotImplementedError
> {
  if (cached) {
    return ok(cached);
  }

  const configResult = getConfig();
  if (configResult.isErr()) {
    return err(configResult.error);
  }

  const config = configResult.value;
  if (config.JACKLINE_SECRET_STORAGE_LOCATION !== "local") {
    return err(
      new NotImplementedError(
        `Secret storage "${config.JACKLINE_SECRET_STORAGE_LOCATION}" is not implemented`,
      ),
    );
  }

  const boxResult = createSecretBox({
    secretStorageLocation: "local",
    base64JacklineMasterKey: config.JACKLINE_MASTER_KEY,
    keyVersion: LOCAL_KEY_VERSION,
  });

  if (boxResult.isErr()) {
    return err(boxResult.error);
  }

  cached = boxResult.value;
  return ok(cached);
}

/** AAD binds ciphertext to tenant + kind + binding scope. */
export function secretAad(input: {
  tenantId: string;
  kind: string;
  serverId: string | null;
  userId: string | null;
  connectionId: string | null;
}): Uint8Array {
  return new TextEncoder().encode(
    [
      input.tenantId,
      input.kind,
      input.serverId ?? "",
      input.userId ?? "",
      input.connectionId ?? "",
    ].join("|"),
  );
}
