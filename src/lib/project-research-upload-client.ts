import type { FolderColor } from "@/lib/project-folder-colors-shared";

export type ResearchUploadedFile = {
  id: string;
  pinnedAt: string | null;
  colorLabel: FolderColor | null;
  attachmentId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
};

type UploadRequestPayload = {
  attachmentId?: string;
  uploadUrl?: string;
  uploadExpectedHeaders?: Record<string, string>;
  error?: string;
};

function putResearchFile(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    Object.entries(headers).forEach(([key, value]) =>
      request.setRequestHeader(key, value),
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("The storage upload was not accepted."));
    };
    request.onerror = () =>
      reject(new Error("The storage upload could not be completed."));
    request.send(file);
  });
}

async function uploadFolderFile({
  baseApi,
  file,
  onProgress,
  createdTextFile = false,
}: {
  baseApi: string;
  file: File;
  onProgress: (progress: number) => void;
  createdTextFile?: boolean;
}) {
  let attachmentId: string | undefined;

  try {
    const response = await fetch(`${baseApi}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        createdTextFile,
      }),
    });
    const upload = (await response.json()) as UploadRequestPayload;

    if (!response.ok || upload.error || !upload.attachmentId || !upload.uploadUrl) {
      throw new Error(upload.error || "Unable to prepare this upload.");
    }

    attachmentId = upload.attachmentId;
    await putResearchFile(
      upload.uploadUrl,
      file,
      upload.uploadExpectedHeaders ?? {
        "Content-Type": file.type || "application/octet-stream",
      },
      onProgress,
    );

    const completeResponse = await fetch(`${baseApi}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId }),
    });
    const complete = (await completeResponse.json()) as {
      file?: ResearchUploadedFile;
      error?: string;
    };

    if (!completeResponse.ok || !complete.file) {
      throw new Error(complete.error || "Unable to finish this upload.");
    }

    onProgress(100);
    return complete.file;
  } catch (error) {
    if (attachmentId) {
      await fetch(`${baseApi}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId, failed: true }),
      }).catch(() => undefined);
    }
    throw error;
  }
}

export function uploadProjectResearchFile({
  projectId,
  folderId,
  ...input
}: {
  projectId: string;
  folderId: string;
  file: File;
  onProgress: (progress: number) => void;
  createdTextFile?: boolean;
}) {
  return uploadFolderFile({
    baseApi: `/api/projects/${projectId}/research/folders/${folderId}`,
    ...input,
  });
}

export function uploadProjectPrivateFile({
  projectId,
  folderId,
  ...input
}: {
  projectId: string;
  folderId: string;
  file: File;
  onProgress: (progress: number) => void;
  createdTextFile?: boolean;
}) {
  return uploadFolderFile({
    baseApi: `/api/projects/${projectId}/private-folders/${folderId}`,
    ...input,
  });
}
