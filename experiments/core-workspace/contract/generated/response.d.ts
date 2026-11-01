export type ContentResponse =
  | {
      message: string;
      status: "invalid-request";
      version: Protocol;
    }
  | {
      contentId: string;
      descriptor: ContentDescriptor;
      requestId: string;
      status: "described";
      version: Protocol;
    }
  | {
      contentId: string;
      requestId: string;
      snapshot: ContentSnapshot;
      status: "snapshot";
      version: Protocol;
    }
  | {
      contentId: string;
      requestId: string;
      snapshot: ContentSnapshot;
      status: "applied";
      version: Protocol;
    }
  | {
      code: RejectionCode;
      contentId: string;
      expectedRevision?: string | null;
      message: string;
      requestId: string;
      status: "rejected";
      version: Protocol;
    }
  | {
      contentId: string;
      expectedRevision: string;
      message: string;
      requestId: string;
      status: "uncertain";
      version: Protocol;
    };
export type Protocol = "1";
export type RejectionCode =
  "forbidden" | "unavailable" | "invalid-data" | "stale-revision";

export interface ContentDescriptor {
  contentId: string;
  schemaDeclared: boolean;
  stateSchema: unknown;
  typeId: string;
}
export interface ContentSnapshot {
  contentId: string;
  data: unknown;
  revision: string;
  typeId: string;
  warning?: string | null;
}
