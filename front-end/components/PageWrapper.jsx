// components/PageWrapper.jsx
export default function PageWrapper({ children, className = "" }) {
  return (
    <main
      className={`min-h-screen w-full flex items-center justify-center ${className}`}
    >
      {children}
    </main>
  );
}
