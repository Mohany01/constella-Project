import * as React from "react";

const SIZE_MAP = {
  sm: { orb: 72, font: "0.8rem", gap: "0em" },
  md: { orb: 100, font: "0.95rem", gap: "0em" },
  lg: { orb: 140, font: "1.05rem", gap: "0em" },
};

const AiLoader = ({
  label = "Generating",
  size = "md",
  className = "",
  state = "loading",
}) => {
  const resolved = SIZE_MAP[size] || SIZE_MAP.md;
  const letters = Array.from(label);
  const rootClass = `ai-loader ai-loader--${size} ${className} ${
    state === "success" ? "is-success" : "is-loading"
  }`.trim();

  return (
    <div
      className={rootClass}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <div
        className="ai-loader-surface"
        style={{
          "--orb-size": `${resolved.orb}px`,
          "--letter-size": resolved.font,
          "--letter-gap": resolved.gap,
        }}
        aria-hidden="true"
      >
        <div className="ai-loader-arc" />
        <div className="ai-loader-orb" />
        <div className="ai-loader-letters">
          {letters.map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className="ai-loader-letter"
              style={{ "--i": index }}
            >
              {letter === " " ? "\u00A0" : letter}
            </span>
          ))}
        </div>
        <div className="ai-loader-check" aria-hidden="true">
          <svg viewBox="0 0 52 52" role="presentation">
            <path d="M14 27.5l8 8L38 20" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default AiLoader;
export { AiLoader };
