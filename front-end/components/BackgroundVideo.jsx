import React from "react";

export default function BackgroundVideo({ src = "/home%20video.mp4", poster = "/auth-bg.jpg", className = "" }) {
  return (
    <div className={`auth-media ${className}`.trim()} aria-hidden>
      <video className="auth-video" autoPlay muted loop playsInline poster={poster}>
        <source src={src} type="video/mp4" />
      </video>
      <div className="auth-media-overlay" />
    </div>
  );
}
