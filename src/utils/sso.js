// Verständliche Meldungen zu den Fehlercodes aus dem SSO-Ablauf (server/src/routes/oidc.js).
const MESSAGES = {
  cancelled: "Die Anmeldung über das ICF-Konto wurde abgebrochen.",
  email_taken:
    "Für diese E-Mail-Adresse gibt es schon ein Konto mit Passwort. Melde dich damit an und verbinde dein ICF-Konto unter Einstellungen → Konto.",
  already_linked: "Dieses ICF-Konto ist bereits mit einem anderen Next-Step-Konto verbunden.",
  other_identity: "Dein Konto ist bereits mit einem anderen ICF-Konto verbunden.",
  no_email: "In deinem ICF-Konto ist keine E-Mail-Adresse hinterlegt. Bitte wende dich an das IT-Team.",
  not_allowed: "Dein ICF-Konto ist für Next Step nicht freigeschaltet. Bitte wende dich an das IT-Team.",
  not_logged_in: "Bitte melde dich zuerst an.",
  expired: "Die Anmeldung hat zu lange gedauert. Bitte versuch es noch einmal.",
  unavailable: "Die Anmeldung über das ICF-Konto ist gerade nicht erreichbar. Bitte später erneut versuchen.",
};

export function ssoMessage(code) {
  return MESSAGES[code] || "Die Anmeldung über das ICF-Konto ist fehlgeschlagen. Bitte versuch es noch einmal.";
}
