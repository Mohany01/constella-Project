// components/PageWrapper.jsx
export default function PageWrapper({ children, className = "" }) {
  return (
    <main className={`min-h-screen w-full ${className}`}>
      {children}
    </main>
  );
}
