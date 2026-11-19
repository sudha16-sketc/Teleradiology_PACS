import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Worklist",
  description: "Radiologist worklist and assigned studies in Axis.",
};

export default function WorklistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
