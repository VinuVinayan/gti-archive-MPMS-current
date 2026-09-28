import { randomUUID } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AttachmentAssetType,
  ProjectCompletionDocumentType,
} from "@prisma/client";

export {
  getFileExtension,
  isAllowedAssetFile,
  isAllowedProfileImage,
  isAllowedProjectCompletionDocument,
  isAllowedSubmissionImage,
} from "@/lib/upload-validation";

const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const PROFILE_AVATAR_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export type S3UploadEndpointMode = "regional" | "accelerate";

const cachedClients: Partial<Record<S3UploadEndpointMode, S3Client>> = {};

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalBooleanEnv(name: string, defaultValue = false) {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  return defaultValue;
}

export function getS3BucketName() {
  return getRequiredEnv("AWS_S3_BUCKET");
}

export function getS3Region() {
  return getRequiredEnv("AWS_REGION");
}

export function isS3TransferAccelerationEnabled() {
  const explicitValue = process.env.S3_USE_ACCELERATE_ENDPOINT;

  if (explicitValue) {
    return getOptionalBooleanEnv("S3_USE_ACCELERATE_ENDPOINT", true);
  }

  const legacyValue = process.env.AWS_S3_TRANSFER_ACCELERATION;

  if (legacyValue) {
    return getOptionalBooleanEnv("AWS_S3_TRANSFER_ACCELERATION", true);
  }

  return true;
}

export function getDefaultS3UploadEndpointMode(): S3UploadEndpointMode {
  return isS3TransferAccelerationEnabled() ? "accelerate" : "regional";
}

export function getMaxAssetUploadBytes() {
  const raw = process.env.ASSET_UPLOAD_MAX_BYTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_MAX_FILE_SIZE_BYTES;
}

function getS3Client(endpointMode = getDefaultS3UploadEndpointMode()) {
  if (cachedClients[endpointMode]) {
    return cachedClients[endpointMode];
  }

  const client = new S3Client({
    region: getS3Region(),
    useAccelerateEndpoint: endpointMode === "accelerate",
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });

  cachedClients[endpointMode] = client;

  return client;
}

export function sanitizeFileName(input: string) {
  const normalized = input
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  if (!normalized) {
    return `file-${randomUUID()}`;
  }

  return normalized;
}

export function getMaxProfileAvatarBytes() {
  return PROFILE_AVATAR_MAX_FILE_SIZE_BYTES;
}

export function buildUserAvatarPrefix(userId: string) {
  return `users/${userId}/avatar/`;
}

export function buildUserAvatarKey(userId: string, originalFileName: string) {
  const safeFileName = sanitizeFileName(originalFileName);
  const uniqueFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName}`;

  return `${buildUserAvatarPrefix(userId)}${uniqueFileName}`;
}

export function buildArchiveCategoryIconPrefix() {
  return "settings/archive-category-icons/";
}

export function buildArchiveCategoryIconKey(userId: string, originalFileName: string) {
  const safeFileName = sanitizeFileName(originalFileName);
  const uniqueFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName}`;

  return `${buildArchiveCategoryIconPrefix()}${userId}/${uniqueFileName}`;
}

type BuildProjectAssetKeyInput = {
  projectId: string;
  stageId?: string | null;
  revisionId?: string | null;
  commentId?: string | null;
  researchFolderId?: string | null;
  privateFolderId?: string | null;
  assetType: AttachmentAssetType;
  safeFileName: string;
};

export function buildProjectAssetKey({
  projectId,
  stageId,
  revisionId,
  commentId,
  researchFolderId,
  privateFolderId,
  assetType,
  safeFileName,
}: BuildProjectAssetKeyInput) {
  switch (assetType) {
    case AttachmentAssetType.REVISION_ORIGINAL: {
      if (!stageId) {
        throw new Error("Revision original assets require stageId.");
      }

      if (!revisionId) {
        return `projects/${projectId}/stages/${stageId}/revisions/staged/${safeFileName}`;
      }

      return `projects/${projectId}/stages/${stageId}/revisions/${revisionId}/assets/original/${safeFileName}`;
    }
    case AttachmentAssetType.STAGE_SUBMISSION: {
      if (!stageId || !commentId) {
        throw new Error("Stage submissions require stageId and commentId.");
      }

      if (revisionId) {
        return `projects/${projectId}/stages/${stageId}/revisions/${revisionId}/comments/${commentId}/submissions/${safeFileName}`;
      }

      return `projects/${projectId}/stages/${stageId}/comments/${commentId}/submissions/${safeFileName}`;
    }
    case AttachmentAssetType.REVISION_PREVIEW: {
      if (!stageId || !revisionId) {
        throw new Error("Revision preview assets require stageId and revisionId.");
      }

      return `projects/${projectId}/stages/${stageId}/revisions/${revisionId}/assets/preview/${safeFileName}`;
    }
    case AttachmentAssetType.REVISION_THUMBNAIL: {
      if (!stageId || !revisionId) {
        throw new Error("Revision thumbnail assets require stageId and revisionId.");
      }

      return `projects/${projectId}/stages/${stageId}/revisions/${revisionId}/assets/thumbnails/${safeFileName}`;
    }
    case AttachmentAssetType.COMMENT_ATTACHMENT: {
      if (!stageId || !commentId) {
        throw new Error("Comment attachments require stageId and commentId.");
      }

      if (revisionId) {
        return `projects/${projectId}/stages/${stageId}/revisions/${revisionId}/comments/${commentId}/attachments/${safeFileName}`;
      }

      return `projects/${projectId}/stages/${stageId}/comments/${commentId}/attachments/${safeFileName}`;
    }
    case AttachmentAssetType.STAGE_INVOICE: {
      if (!stageId) {
        throw new Error("Stage invoice assets require stageId.");
      }

      return `projects/${projectId}/stages/${stageId}/invoice/${safeFileName}`;
    }
    case AttachmentAssetType.FINAL_ARCHIVE: {
      if (!stageId) {
        throw new Error("Final archive assets require stageId.");
      }

      return `projects/${projectId}/stages/${stageId}/final/archive/${safeFileName}`;
    }
    case AttachmentAssetType.PROJECT_RESEARCH_FILE: {
      if (!researchFolderId) {
        throw new Error("Project research assets require researchFolderId.");
      }

      return `projects/${projectId}/research/${researchFolderId}/${safeFileName}`;
    }
    case AttachmentAssetType.PROJECT_PRIVATE_FILE: {
      if (!privateFolderId) {
        throw new Error("Project private assets require privateFolderId.");
      }

      return `projects/${projectId}/private/${privateFolderId}/${safeFileName}`;
    }
    case AttachmentAssetType.GENERAL_PROJECT_ASSET:
    default:
      return `projects/${projectId}/assets/general/${safeFileName}`;
  }
}

type BuildProjectCompletionDocumentKeyInput = {
  projectId: string;
  documentType: ProjectCompletionDocumentType;
  safeFileName: string;
};

export function buildProjectCompletionDocumentKey({
  projectId,
  documentType,
  safeFileName,
}: BuildProjectCompletionDocumentKeyInput) {
  switch (documentType) {
    case ProjectCompletionDocumentType.AUTHORITY_APPROVAL_PROOF:
      return `archives/${projectId}/completion/approval/${safeFileName}`;
    case ProjectCompletionDocumentType.COPYRIGHT_TRANSFER:
      return `archives/${projectId}/completion/copyright/${safeFileName}`;
    case ProjectCompletionDocumentType.INVOICE:
    default:
      return `archives/${projectId}/completion/invoices/${safeFileName}`;
  }
}

function buildManualUploadFileName(originalFileName: string) {
  const safeFileName = sanitizeFileName(originalFileName);
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName}`;
}

export function buildManualArchiveFileKey(userId: string, originalFileName: string) {
  return `archives/manual/${userId}/${buildManualUploadFileName(originalFileName)}`;
}

export function buildManualLibraryAssetKey(userId: string, originalFileName: string) {
  return `library/manual/${userId}/${buildManualUploadFileName(originalFileName)}`;
}

type PresignedUploadInput = {
  bucket?: string;
  storageKey: string;
  mimeType: string;
  expiresInSeconds?: number;
  endpointMode?: S3UploadEndpointMode;
};

export type PresignedUploadTarget = {
  uploadUrl: string;
  uploadHost: string;
  endpointMode: S3UploadEndpointMode;
  region: string;
  expiresInSeconds: number;
  expectedHeaders: {
    "Content-Type": string;
  };
};

export async function createPresignedUploadTarget({
  bucket = getS3BucketName(),
  storageKey,
  mimeType,
  expiresInSeconds = 60 * 10,
  endpointMode = getDefaultS3UploadEndpointMode(),
}: PresignedUploadInput): Promise<PresignedUploadTarget> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(getS3Client(endpointMode), command, {
    expiresIn: expiresInSeconds,
  });
  const uploadHost = new URL(uploadUrl).host;

  return {
    uploadUrl,
    uploadHost,
    endpointMode,
    region: getS3Region(),
    expiresInSeconds,
    expectedHeaders: {
      "Content-Type": mimeType,
    },
  };
}

export async function createPresignedUploadUrl(input: PresignedUploadInput) {
  const target = await createPresignedUploadTarget(input);

  return target.uploadUrl;
}

type PresignedDownloadInput = {
  bucket?: string;
  storageKey: string;
  fileName: string;
  mimeType?: string;
  expiresInSeconds?: number;
};

function encodeRfc5987ValueChars(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
    .replace(/\*/g, "%2A")
    .replace(/%(7C|60|5E)/g, (_, hex) => `%${hex.toLowerCase()}`);
}

function buildContentDisposition(type: "attachment" | "inline", fileName: string) {
  const fallbackFileName =
    sanitizeFileName(fileName)
      .replace(/"/g, "")
      .slice(0, 180) || "download";

  return `${type}; filename="${fallbackFileName}"; filename*=UTF-8''${encodeRfc5987ValueChars(
    fileName,
  )}`;
}

export async function createPresignedDownloadUrl({
  bucket = getS3BucketName(),
  storageKey,
  fileName,
  expiresInSeconds = 60 * 5,
}: PresignedDownloadInput) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentDisposition: buildContentDisposition("attachment", fileName),
  });

  return getSignedUrl(getS3Client(), command, {
    expiresIn: expiresInSeconds,
  });
}

export async function createPresignedPreviewUrl({
  bucket = getS3BucketName(),
  storageKey,
  fileName,
  mimeType,
  expiresInSeconds = 60 * 5,
}: PresignedDownloadInput) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentDisposition: buildContentDisposition("inline", fileName),
    ResponseContentType: mimeType || undefined,
  });

  return getSignedUrl(getS3Client(), command, {
    expiresIn: expiresInSeconds,
  });
}

export async function readTextObject({
  bucket = getS3BucketName(),
  storageKey,
  maxBytes,
}: {
  bucket?: string;
  storageKey: string;
  maxBytes: number;
}) {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
    }),
  );

  if (!response.Body) {
    throw new Error("Text file content is unavailable.");
  }

  return response.Body.transformToString("utf-8");
}

export async function copyStoredObject(input: {
  sourceBucket: string;
  sourceKey: string;
  bucket: string;
  storageKey: string;
}) {
  await getS3Client("regional").send(new CopyObjectCommand({
    Bucket: input.bucket,
    Key: input.storageKey,
    CopySource: `${input.sourceBucket}/${encodeURIComponent(input.sourceKey)}`,
  }));
}

export async function writeTextObject(input: {
  bucket: string;
  storageKey: string;
  content: string;
}) {
  await getS3Client("regional").send(new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.storageKey,
    Body: Buffer.from(input.content, "utf8"),
    ContentType: "text/plain",
  }));
}

export async function getObjectMetadata(
  storageKey: string,
  bucket = getS3BucketName(),
) {
  return getS3Client().send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }),
  );
}

export async function deleteObjectIfNeeded(
  storageKey: string,
  bucket = getS3BucketName(),
) {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }),
  );
}
