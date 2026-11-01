export type ContentRequest =
  | {
      contentId: string;
      operation: "content.describe";
      requestId: string;
      version: Protocol;
    }
  | {
      contentId: string;
      operation: "content.inspect";
      requestId: string;
      version: Protocol;
    }
  | {
      contentId: string;
      data: unknown;
      expectedRevision: string;
      operation: "content.update";
      requestId: string;
      version: Protocol;
    };
export type Protocol = "1";
