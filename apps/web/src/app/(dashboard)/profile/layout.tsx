import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
  description: "Account profile and contact details in Axis.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
