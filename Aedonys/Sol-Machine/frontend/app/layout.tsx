import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Sol Machine",
  description: "RC car racing with Solana betting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
