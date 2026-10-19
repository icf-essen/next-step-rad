export const SESSION_COOKIE = "nsr_session";

/** Fehler mit HTTP-Status, deren Meldung an den Client gehen darf. */
export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
  }
}
