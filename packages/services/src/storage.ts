/**
 * Private object storage adapter (Section 23). S3-compatible; the bucket is never public.
 * Object keys are unpredictable and never returned to clients.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketPolicyStatusCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { AppConfig } from "@buytrail/config";

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string, maxBytes: number): Promise<Buffer | null>;
  head(key: string): Promise<{ size: number } | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
  /** Returns "private", "public" or "unknown" (backend does not report policy status). */
  privacy(): Promise<"private" | "public" | "unknown">;
}

export function createS3Store(config: AppConfig): ObjectStore {
  const client = new S3Client({
    endpoint: config.OBJECT_STORAGE_ENDPOINT,
    region: config.OBJECT_STORAGE_REGION,
    forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.OBJECT_STORAGE_BUCKET;
  const isMissing = (e: unknown) => {
    const n = (e as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
    const s = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return n === "NoSuchKey" || n === "NotFound" || s === 404;
  };
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key, maxBytes) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if ((r.ContentLength ?? 0) > maxBytes) throw new Error("Object exceeds read limit");
        const bytes = await r.Body!.transformToByteArray();
        if (bytes.byteLength > maxBytes) throw new Error("Object exceeds read limit");
        return Buffer.from(bytes);
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: r.ContentLength ?? 0 };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    },
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },
    async privacy() {
      try {
        const r = await client.send(new GetBucketPolicyStatusCommand({ Bucket }));
        return r.PolicyStatus?.IsPublic ? "public" : "private";
      } catch {
        // Anonymous read probe: an unauthenticated GET must not succeed.
        try {
          const r = await fetch(`${config.OBJECT_STORAGE_ENDPOINT}/${Bucket}/`, { signal: AbortSignal.timeout(3000) });
          return r.status === 200 ? "public" : r.status === 403 || r.status === 401 ? "private" : "unknown";
        } catch {
          return "unknown";
        }
      }
    },
  };
}

/** In-memory store for unit tests. */
export function createMemoryStore(): ObjectStore & { keys(): string[] } {
  const m = new Map<string, Buffer>();
  return {
    keys: () => [...m.keys()],
    async put(k, b) {
      m.set(k, Buffer.from(b));
    },
    async get(k, max) {
      const b = m.get(k);
      if (!b) return null;
      if (b.length > max) throw new Error("Object exceeds read limit");
      return b;
    },
    async head(k) {
      const b = m.get(k);
      return b ? { size: b.length } : null;
    },
    async delete(k) {
      m.delete(k);
    },
    async ensureBucket() {},
    async privacy() {
      return "private";
    },
  };
}
