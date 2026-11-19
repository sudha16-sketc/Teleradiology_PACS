import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Request an Axis account.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
