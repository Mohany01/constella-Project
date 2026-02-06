import Image from "next/image";

export default function Logo({
  className = "",
  showName = false,
  variant = "default",
  size = 52,
}) {
  const isWhite = variant === "white";
  const src = isWhite ? "/white%20Logo.png" : "/logo.png";
  return (
    <div
      className={`logo ${isWhite ? "logo-variant-white" : ""} ${className}`.trim()}
      aria-label="Constella logo"
    >
      <Image
        src={src}
        alt="Constella logo"
        width={size}
        height={size}
        priority
        className={`logo-img ${isWhite ? "logo-img-plain" : ""}`.trim()}
        style={{ width: size, height: size }}
      />
      {showName && <span className="logo-type">Constella</span>}
    </div>
  );
}
