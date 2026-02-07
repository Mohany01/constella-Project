import "../styles/globals.css";
import { Inter, Manrope } from "next/font/google";

const bodyFont = Inter({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-body",
  display: "swap",
});

const headingFont = Manrope({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata = {
  title: "Constella",
  description: "Constella App",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
