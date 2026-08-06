import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObjectHead {
  size: number;
  sha256: string | undefined;
}

/**
 * S3-compatible object storage for attachment bytes. The API process only
 * signs URLs and stores metadata; file bytes flow directly between clients
 * and object storage.
 */
export interface ObjectStorage {
  ensureBucket(): Promise<void>;
  createPresignedUploadUrl(
    key: string,
    options: {
      contentType: string;
      size: number;
      sha256: string | undefined;
      ttlSeconds: number;
    },
  ): Promise<string>;
  createPresignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  headObject(key: string): Promise<StoredObjectHead>;
  deleteObject(key: string): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<void>;
}

export function createObjectStorage(options: {
  enabled: boolean;
  endpoint: string | undefined;
  region: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucket: string | undefined;
  forcePathStyle: boolean;
}): ObjectStorage {
  if (!options.enabled) {
    return new MemoryObjectStorage();
  }
  if (
    !options.endpoint ||
    !options.accessKeyId ||
    !options.secretAccessKey ||
    !options.bucket
  ) {
    throw new Error(
      "FILES_ENABLED requires S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET",
    );
  }
  return new S3ObjectStorage({
    endpoint: options.endpoint,
    region: options.region,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    bucket: options.bucket,
    forcePathStyle: options.forcePathStyle,
  });
}

class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #region: string;

  constructor(options: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle: boolean;
  }) {
    this.#bucket = options.bucket;
    this.#region = options.region;
    this.#client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(
        new CreateBucketCommand({ Bucket: this.#bucket }),
      );
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") {
        throw error;
      }
    }
  }

  async createPresignedUploadUrl(
    key: string,
    options: {
      contentType: string;
      size: number;
      sha256: string | undefined;
      ttlSeconds: number;
    },
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.size,
      ...(options.sha256
        ? {
            ChecksumSHA256: Buffer.from(options.sha256, "hex").toString("base64"),
          }
        : {}),
    });
    return getSignedUrl(this.#client, command, {
      expiresIn: options.ttlSeconds,
      signableHeaders: new Set(["content-type", "content-length", "x-amz-checksum-sha256"]),
    });
  }

  async createPresignedDownloadUrl(
    key: string,
    ttlSeconds: number,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key,
    });
    return getSignedUrl(this.#client, command, { expiresIn: ttlSeconds });
  }

  async headObject(key: string): Promise<StoredObjectHead> {
    const response = await this.#client.send(
      new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    return {
      size: response.ContentLength ?? 0,
      sha256: response.ChecksumSHA256
        ? Buffer.from(response.ChecksumSHA256, "base64").toString("hex")
        : undefined,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
  }

  async close(): Promise<void> {
    this.#client.destroy();
  }

  async healthCheck(): Promise<void> {
    await this.#client.config.credentials();
    await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
  }
}

interface MemoryObject {
  bytes: Buffer;
}

/**
 * In-memory object storage used when S3 is not configured and in tests.
 * Presigned URLs are unusable over the network, so routes that require real
 * transfers must run against a configured S3-compatible endpoint; the memory
 * adapter supports the metadata flow (intent -> complete) with a null URL.
 */
export class MemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, MemoryObject>();

  async ensureBucket(): Promise<void> {
    // No-op: the memory adapter has no buckets.
  }

  async createPresignedUploadUrl(
    _key: string,
    options: {
      contentType: string;
      size: number;
      sha256: string | undefined;
      ttlSeconds: number;
    },
  ): Promise<string> {
    void options;
    return "memory://upload-placeholder";
  }

  async createPresignedDownloadUrl(
    _key: string,
    _ttlSeconds: number,
  ): Promise<string> {
    return "memory://download-placeholder";
  }

  async headObject(key: string): Promise<StoredObjectHead> {
    const object = this.#objects.get(key);
    if (!object) {
      throw new ObjectNotFoundError(key);
    }
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(
        object.bytes.buffer as ArrayBuffer,
        object.bytes.byteOffset,
        object.bytes.byteLength,
      ),
    );
    return {
      size: object.bytes.length,
      sha256: Buffer.from(hash).toString("hex"),
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  async close(): Promise<void> {
    this.#objects.clear();
  }

  async healthCheck(): Promise<void> {
    // Always available.
  }

  /** Test helper: stages bytes so `complete` can verify them. */
  stageObject(key: string, bytes: Buffer): void {
    this.#objects.set(key, { bytes });
  }
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found in storage: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}
