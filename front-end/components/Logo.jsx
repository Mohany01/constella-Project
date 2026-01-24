import Image from "next/image";

export default function Logo({ className = "", showName = false }) {
  return (
    <div className={`logo ${className}`.trim()} aria-label="Constella logo">
      <Image
        src="/Constella%20Logo%20color.png"
        alt="Constella logo"
        width={52}
        height={52}
        priority
        className="logo-img"
      />
      {showName && <span className="logo-type">Constella</span>}
    </div>
  );
}
