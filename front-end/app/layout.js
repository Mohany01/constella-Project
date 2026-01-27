import "../styles/globals.css";

export const metadata = {
  title: "Constella",
  description: "Constella App",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon.png" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
