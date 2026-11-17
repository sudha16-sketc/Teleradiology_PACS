import type { Metadata } from "next";
import DocumentationContent from "./DocumentationContent";

export const metadata: Metadata = {
  title: "Documentation | Axis",
  description:
    "Product guide, workflows, features, and security notes for Axis.",
};

export default function DocumentationPage() {
  return <DocumentationContent />;
}