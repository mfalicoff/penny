export type Failure = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict";

/** An expected application failure; HTTP status mapping belongs to the adapter. */
export class ApplicationError extends Error {
  readonly reason: Failure;

  constructor(reason: Failure, message: string) {
    super(message);
    this.name = "ApplicationError";
    this.reason = reason;
  }
}
