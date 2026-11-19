import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Study Queue",
  description: "Manager study queue and assignment workflow in Axis.",
};

export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
