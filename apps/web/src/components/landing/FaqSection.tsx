"use client";

import { useState } from "react";

const faqs = [
  {
    question: "What is this platform?",
    answer:
      "A teleradiology PACS and clinical reporting platform for connecting hospitals, radiologists and workflow managers.",
  },
  {
    question: "Can hospitals submit DICOM studies?",
    answer:
      "Yes. Hospitals can submit DICOM ZIP files together with required patient/study information.",
  },
  {
    question: "Who can view a study?",
    answer:
      "Access is controlled according to the user's role and authorization.",
  },
  {
    question: "Can managers edit radiologist reports?",
    answer:
      "No. Managers manage workflow and verification but should not modify clinical report content.",
  },
  {
    question: "Can hospitals request corrections?",
    answer:
      "Yes. Hospitals can submit a correction request that is routed through the manager to the responsible radiologist.",
  },
  {
    question: "Are report versions preserved?",
    answer:
      "Signed report versions are preserved, with corrections represented as new versions.",
  },
  {
    question: "Can administrators manage backup policies?",
    answer:
      "Yes. Backup and retention management is an administrative capability.",
  },
];

function PlusIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function FaqItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-semibold text-slate-900 transition-colors hover:text-primary"
        aria-expanded={isOpen}
      >
        <span>{question}</span>
        {isOpen ? <MinusIcon /> : <PlusIcon />}
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? "max-h-40 pb-5 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <p className="text-sm leading-relaxed text-slate-600">{answer}</p>
      </div>
    </div>
  );
}

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Frequently asked questions
        </h2>
        <div className="mt-12 rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          {faqs.map((faq, index) => (
            <FaqItem
              key={faq.question}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === index}
              onToggle={() =>
                setOpenIndex(openIndex === index ? null : index)
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}