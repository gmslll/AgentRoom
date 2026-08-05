export const attachmentScanStates = ["pending", "clean", "flagged"] as const;
export type AttachmentScanState = (typeof attachmentScanStates)[number];

export interface Attachment {
  id: string;
  roomId: string;
  uploaderMemberId: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  scanState: AttachmentScanState;
  createdAt: string;
}

export interface AttachmentStorageRecord extends Attachment {
  storageKey: string;
}

export interface CreateAttachmentRecord {
  id: string;
  roomId: string;
  uploaderMemberId: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string | undefined;
  storageKey: string;
  scanState: AttachmentScanState;
  createdAt: string;
}
