import React from "react";

/** Links zu Impressum und Datenschutz (Adressen kommen aus der API-Konfiguration). */
export function LegalLinks({ legal }) {
  if (!legal || (!legal.imprintUrl && !legal.privacyUrl)) return null;
  return (
    <p className="nsr-legal">
      {legal.imprintUrl && (
        <a href={legal.imprintUrl} target="_blank" rel="noopener noreferrer">
          Impressum
        </a>
      )}
      {legal.imprintUrl && legal.privacyUrl && <span aria-hidden="true"> · </span>}
      {legal.privacyUrl && (
        <a href={legal.privacyUrl} target="_blank" rel="noopener noreferrer">
          Datenschutz
        </a>
      )}
    </p>
  );
}
