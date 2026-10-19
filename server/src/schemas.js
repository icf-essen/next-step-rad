// Gemeinsame JSON-Schema-Bausteine. Fastify prüft jeden Request dagegen,
// bevor Route-Code läuft. Die Datenbank prüft per CHECK-Constraints ein zweites Mal.

export const EMAIL = { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+$" };
export const PASSWORD = { type: "string", minLength: 10, maxLength: 200 };
export const ANY_PASSWORD = { type: "string", maxLength: 200 };
export const DISPLAY_NAME = { type: "string", maxLength: 60 };
export const HEX_COLOR = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
export const UUID = {
  type: "string",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
};
export const WEEK_ID = { type: "string", pattern: "^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$" };
export const AREA_KEY = { type: "string", pattern: "^[a-z]{1,30}$" };
export const GROUP_NAME = { type: "string", minLength: 1, maxLength: 40 };
