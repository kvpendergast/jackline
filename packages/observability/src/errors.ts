import { ErrorCode, JacklineError } from "@jackline/shared";

/** Observability bootstrap or export failure. */
export class ObservabilityError extends JacklineError {
  constructor(message: string) {
    super(ErrorCode.INTERNAL, message);
    this.name = "ObservabilityError";
  }
}
