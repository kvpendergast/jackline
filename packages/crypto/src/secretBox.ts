import { err, ok, type Result } from "neverthrow";
import { EncryptionError, NotImplementedError } from "@mesh/shared";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretBoxConfig = {
    secretStorageLocation: 'local',
    base64MeshMasterKey: string;
    keyVersion: number;
} | {
    secretStorageLocation: 'aws_kms',
    awsKmsConfig: {
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
    };
} | {
    secretStorageLocation: 'gcp_kms',
    gcpKmsConfig: {
        projectId: string;
        credentials: {
            client_email: string;
            private_key: string;
        };
    };
}

export type EncryptedPayload = {
    ciphertext: Buffer;
    nonce: Buffer;
    keyVersion: number;
}

export interface SecretBox {
    encrypt(plaintext: Uint8Array, aad?: Uint8Array): Result<EncryptedPayload, EncryptionError>;
    decrypt(payload: EncryptedPayload, aad?: Uint8Array): Result<Uint8Array, EncryptionError>;
}

class LocalSecretBox implements SecretBox {
    private readonly meshMasterKey: Uint8Array;
    private readonly keyVersion: number = 1;
    constructor(meshMasterKey: Uint8Array, keyVersion: number) {
        this.meshMasterKey = meshMasterKey;
        this.keyVersion = keyVersion;
    }

    encrypt(plaintext: Uint8Array, aad?: Uint8Array): Result<EncryptedPayload, EncryptionError> {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.meshMasterKey, nonce);
        if (aad) {
            cipher.setAAD(aad);
        }

        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();

        return ok({
            ciphertext: Buffer.concat([ciphertext, tag]), // or keep tag separate
            nonce,
            keyVersion: this.keyVersion,
          });
    }

    decrypt(payload: EncryptedPayload, aad?: Uint8Array): Result<Uint8Array, EncryptionError> {
        if (payload.keyVersion !== this.keyVersion) {
            return err(new EncryptionError(`Key version mismatch: expected ${this.keyVersion}, got ${payload.keyVersion}`));
        }

        const tagLength = 16;
        const data = payload.ciphertext;

        if (data.byteLength < tagLength) {
            return err(new EncryptionError("Invalid ciphertext"));
        }
        const tag = data.subarray(data.byteLength - tagLength);
        const encrypted = data.subarray(0, data.byteLength - tagLength);
        try {
            const decipher = createDecipheriv(
            "aes-256-gcm",
            this.meshMasterKey,           // Uint8Array, 32 bytes
            payload.nonce,      // same 12 bytes from encrypt
            );
            if (aad) {
                decipher.setAAD(aad);  // must match encrypt AAD
            }

            decipher.setAuthTag(tag);
            const plaintext = Buffer.concat([
                decipher.update(encrypted),
                decipher.final(),      // throws if tag/AAD/key/nonce wrong
            ]);
            return ok(new Uint8Array(plaintext));
        } catch {
            return err(new EncryptionError("Decryption failed"));
        }
    }
}

function parseMasterKey(base64MasterKey: string): Result<Uint8Array, EncryptionError> {
    let bytes: Buffer;
    try {
        bytes = Buffer.from(base64MasterKey, "base64");
    } catch {
        return err(new EncryptionError("Invalid master key encoding"));
    }
    if (bytes.byteLength !== 32) {
        return err(new EncryptionError("Master key must be 32 bytes"));
    }
    return ok(new Uint8Array(bytes));
}
    
function createLocalSecretBox(base64MasterKey: string, keyVersion: number): Result<SecretBox, Error> {
    return parseMasterKey(base64MasterKey).map((key) => new LocalSecretBox(key, keyVersion));
}

export function createSecretBox(secretBoxConfig: SecretBoxConfig): Result<SecretBox, NotImplementedError | EncryptionError> {
    switch (secretBoxConfig.secretStorageLocation) {
        case "local":
            return createLocalSecretBox(secretBoxConfig.base64MeshMasterKey, secretBoxConfig.keyVersion).mapErr((e) => new EncryptionError(e.message));
        case "aws_kms":
            return err(new NotImplementedError());
        case "gcp_kms":
            return err(new NotImplementedError());
        default:
            return err(new NotImplementedError());
    }
}