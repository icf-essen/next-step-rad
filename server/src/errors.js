export const SESSION_COOKIE = "nsr_session";

/** Fehler mit HTTP-Status, deren Meldung an den Client gehen darf. */
export class HttpError extends Error {
  /** code: optionale maschinenlesbare Kennung für das Frontend (z. B. "email_unverified"). */
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
    this.code = code;
  }
}
