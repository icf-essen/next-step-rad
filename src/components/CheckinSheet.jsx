import React from "react";
import { X } from "lucide-react";
import { AREA_ORDER, AREA_META } from "../constants.js";
import { AreaChip } from "./AreaChip.jsx";

export function CheckinSheet({
  step,
  tempScores,
  setTempScores,
  colors,
  nextStepArea,
  setNextStepArea,
  nextStepText,
  setNextStepText,
  canShare,
  shareWithGroup,
  setShareWithGroup,
  onBack,
  onNext,
  onSave,
  onClose,
  saving,
  error,
}) {
  return (
    <div className="nsr-overlay" onClick={onClose}>
      <div className="nsr-sheet nsr-sheet-tall" onClick={(e) => e.stopPropagation()}>
        <div className="nsr-sheet-handle" />
        <div className="nsr-sheet-header">
          <h2 className="nsr-sheet-title">
            {step === 1 ? "Wie steht's diese Woche?" : "Dein Next Step"}
          </h2>
          <button className="nsr-icon-btn" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        {step === 1 && (
          <div className="nsr-scroll">
            <p className="nsr-sheet-text">Gib jedem Bereich eine Punktzahl zwischen 0 und 10.</p>
            {AREA_ORDER.map((key) => {
              const meta = AREA_META[key];
              const Icon = meta.icon;
              const color = colors[key] || meta.defaultColor;
              const value = tempScores[key] ?? 5;
              return (
                <div className="nsr-slider-row" key={key}>
                  <div className="nsr-slider-label">
                    <Icon size={17} strokeWidth={2} color={color} />
                    <span>{meta.label}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={value}
                    style={{ accentColor: color }}
                    onChange={(e) =>
                      setTempScores((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                  />
                  <span className="nsr-slider-value" style={{ color }}>
                    {value}
                  </span>
                </div>
              );
            })}
            <button className="nsr-btn nsr-btn-primary" onClick={onNext}>
              Weiter
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="nsr-scroll">
            <p className="nsr-sheet-text">
              Wähle einen Bereich, in dem du diese Woche einen kleinen nächsten Schritt gehen möchtest.
            </p>
            <div className="nsr-chip-row">
              {AREA_ORDER.map((key) => (
                <AreaChip
                  key={key}
                  areaKey={key}
                  active={nextStepArea === key}
                  color={colors[key] || AREA_META[key].defaultColor}
                  onClick={() => setNextStepArea(key)}
                />
              ))}
            </div>
            <textarea
              className="nsr-textarea"
              placeholder="Was ist dein Next Step für diese Woche? Halt ihn klein und konkret."
              value={nextStepText}
              onChange={(e) => setNextStepText(e.target.value)}
              rows={4}
            />
            {canShare && (
              <label className="nsr-checkbox-row">
                <input
                  type="checkbox"
                  checked={shareWithGroup}
                  onChange={(e) => setShareWithGroup(e.target.checked)}
                />
                <span>Mit meiner Gruppe teilen</span>
              </label>
            )}
            {error && (
              <p className="nsr-error" role="alert">
                {error}
              </p>
            )}
            <div className="nsr-btn-row">
              <button className="nsr-btn nsr-btn-ghost" onClick={onBack}>
                Zurück
              </button>
              <button
                className="nsr-btn nsr-btn-primary"
                disabled={!nextStepArea || !nextStepText.trim() || saving}
                onClick={onSave}
              >
                {saving ? "Speichert …" : "Speichern"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
