import type { Metadata } from "next";

import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import TrustStrip from "@/components/landing/TrustStrip";
import ProblemSolution from "@/components/landing/ProblemSolution";
import Features from "@/components/landing/Features";
import DicomSection from "@/components/landing/DicomSection";
import ReportingSection from "@/components/landing/ReportingSection";
import Workflow from "@/components/landing/Workflow";
import RolesSection from "@/components/landing/RolesSection";
import SecuritySection from "@/components/landing/SecuritySection";
import BackupRetentionSection from "@/components/landing/BackupRetentionSection";
import MetricsSection from "@/components/landing/MetricsSection";
import CtaSection from "@/components/landing/CtaSection";
import FaqSection from "@/components/landing/FaqSection";
import Footer from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "Axis — Teleradiology PACS & Clinical Reporting Platform",
  description:
    "A teleradiology PACS and clinical reporting platform for connecting hospitals, radiologists and workflow managers.",
};

export default function LandingPage() {
  return (
    <div className="landing flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <div id="overview">
          <TrustStrip />
        </div>
        <ProblemSolution />
        <Features />
        <DicomSection />
        <ReportingSection />
        <Workflow />
        <RolesSection />
        <SecuritySection />
        <BackupRetentionSection />
        <MetricsSection />
        <CtaSection />
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}