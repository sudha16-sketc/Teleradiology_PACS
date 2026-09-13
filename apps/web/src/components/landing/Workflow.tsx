"use client";

import { useInView } from "@/components/landing/useInView";

const steps = [
  {
    num: "01",
    title: "Submit",
    desc: "Hospital submits DICOM and patient information.",
  },
  {
    num: "02",
    title: "Assign",
    desc: "Manager receives the study and assigns it to a radiologist.",
  },
  {
    num: "03",
    title: "Read",
    desc: "Radiologist opens the study and reviews the images.",
  },
  {
    num: "04",
    title: "Report",
    desc: "Radiologist creates and verifies the report.",
  },
  {
    num: "05",
    title: "Sign",
    desc: "Radiologist signs the report and submits it for verification.",
  },
  {
    num: "06",
    title: "Verify",
    desc: "Manager or administrator verifies the report.",
  },
  {
    num: "07",
    title: "Deliver",
    desc: "The verified report is delivered to the originating hospital.",
  },
  {
    num: "08",
    title: "Accept",
    desc: "Hospital reviews and accepts the final report.",
  },
];

const correctionSteps = [
  "Signed Report V1",
  "Correction Requested",
  "Radiologist Updates",
  "Signed Report V2",
  "Verification",
  "Delivery",
];

function StepCard({
  step,
  index,
  visible,
}: {
  step: (typeof steps)[number];
  index: number;
  visible: boolean;
}) {
  const isLeft = index % 2 === 0;

  return (
    <div
      style={{ transitionDelay: `${index * 100}ms` }}
      className={`rounded-2xl border border-blue-100 p-6 transition-all duration-700 ease-out ${
        visible
          ? "translate-y-0 opacity-100"
          : isLeft
            ? "-translate-x-8 opacity-0"
            : "translate-x-8 opacity-0"
      } ${index % 2 === 0 ? "bg-blue-50/60" : "bg-white"}`}
    >
      <span className="text-4xl font-extrabold tracking-tight text-blue-600/20">
        {step.num}
      </span>
      <h3 className="mt-1 text-lg font-semibold text-slate-900">
        {step.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{step.desc}</p>
    </div>
  );
}

function TimelineDot({
  num,
  index,
}: {
  num: string;
  index: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 100}ms` }}
      className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-xs font-bold text-blue-600 shadow-sm transition-all duration-500 ${
        inView ? "scale-100 opacity-100" : "scale-75 opacity-0"
      }`}
    >
      {num}
    </div>
  );
}

function DesktopRow({
  step,
  index,
}: {
  step: (typeof steps)[number];
  index: number;
}) {
  const isLeft = index % 2 === 0;
  const { ref: leftRef, inView: leftInView } = useInView<HTMLDivElement>();
  const { ref: rightRef, inView: rightInView } = useInView<HTMLDivElement>();

  return (
    <div className="grid grid-cols-[1fr_48px_1fr] items-center">
      {isLeft ? (
        <>
          <div ref={leftRef} className="pr-8">
            <StepCard step={step} index={index} visible={leftInView} />
          </div>
          <div className="flex justify-center">
            <TimelineDot num={step.num} index={index} />
          </div>
          <div />
        </>
      ) : (
        <>
          <div />
          <div className="flex justify-center">
            <TimelineDot num={step.num} index={index} />
          </div>
          <div ref={rightRef} className="pl-8">
            <StepCard step={step} index={index} visible={rightInView} />
          </div>
        </>
      )}
    </div>
  );
}

function MobileRow({
  step,
  index,
}: {
  step: (typeof steps)[number];
  index: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className="relative pl-12">
      <div
        style={{ transitionDelay: `${index * 80}ms` }}
        className={`absolute left-[11px] top-5 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-[10px] font-bold text-blue-600 shadow-sm transition-all duration-500 ${
          inView ? "scale-100 opacity-100" : "scale-75 opacity-0"
        }`}
      >
        {step.num}
      </div>
      <div
        style={{ transitionDelay: `${index * 80}ms` }}
        className={`rounded-2xl border border-blue-100 p-5 transition-all duration-700 ease-out ${
          inView ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
        } ${index % 2 === 0 ? "bg-blue-50/60" : "bg-white"}`}
      >
        <span className="text-3xl font-extrabold tracking-tight text-blue-600/20">
          {step.num}
        </span>
        <h3 className="mt-1 text-base font-semibold text-slate-900">
          {step.title}
        </h3>
        <p className="mt-1.5 text-sm leading-5 text-slate-500">{step.desc}</p>
      </div>
    </div>
  );
}

function AnimatedLine({ vertical }: { vertical: boolean }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`${
        vertical
          ? "absolute left-1/2 top-0 bottom-0 -translate-x-1/2 hidden md:block"
          : "absolute left-[24.5px] top-0 bottom-0 md:hidden"
      }`}
    >
      <div
        className={`w-px bg-gradient-to-b from-blue-200 via-blue-300 to-blue-200 transition-all ease-out ${
          inView ? "opacity-100" : "opacity-0"
        }`}
        style={{
          height: inView ? "100%" : "0%",
          transitionDuration: "1.4s",
        }}
      />
    </div>
  );
}

export default function Workflow() {
  const { ref: headingRef, inView: headingInView } =
    useInView<HTMLDivElement>();
  const { ref: corrRef, inView: corrInView } = useInView<HTMLDivElement>();

  return (
    <section id="workflow" className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div ref={headingRef} className="text-center">
          <h2
            className={`text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl transition-all duration-700 ${
              headingInView
                ? "translate-y-0 opacity-100"
                : "translate-y-6 opacity-0"
            }`}
          >
            One connected workflow from study to signed report.
          </h2>
          <p
            className={`mx-auto mt-4 max-w-2xl text-lg text-slate-500 transition-all duration-700 delay-100 ${
              headingInView
                ? "translate-y-0 opacity-100"
                : "translate-y-6 opacity-0"
            }`}
          >
            An end-to-end process connecting every role in the radiology
            workflow.
          </p>
        </div>

        <div className="relative mt-16 md:mt-20">
          <AnimatedLine vertical />
          <AnimatedLine vertical={false} />

          <div className="hidden md:flex flex-col gap-10">
            {steps.map((step, i) => (
              <DesktopRow key={step.num} step={step} index={i} />
            ))}
          </div>

          <div className="flex flex-col gap-4 md:hidden">
            {steps.map((step, i) => (
              <MobileRow key={step.num} step={step} index={i} />
            ))}
          </div>
        </div>

        <div ref={corrRef} className="mt-24">
          <div
            className={`rounded-2xl border border-slate-200 bg-slate-50 p-8 sm:p-12 transition-all duration-700 ${
              corrInView
                ? "translate-y-0 opacity-100"
                : "translate-y-8 opacity-0"
            }`}
          >
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">
              Corrections without losing history.
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
              Previous signed versions are preserved. Corrections flow back to
              the radiologist, who updates the report and signs a new version.
              Every version is retained for audit and compliance.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {correctionSteps.map((s, i) => (
                <div key={s} className="flex items-center gap-3">
                  <div
                    style={{ transitionDelay: `${i * 100}ms` }}
                    className={`rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all duration-500 ${
                      corrInView
                        ? "translate-y-0 opacity-100"
                        : "translate-y-3 opacity-0"
                    }`}
                  >
                    {s}
                  </div>
                  {i < correctionSteps.length - 1 && (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`h-4 w-4 shrink-0 text-blue-300 transition-all duration-500 ${
                        corrInView ? "opacity-100" : "opacity-0"
                      }`}
                      style={{ transitionDelay: `${i * 100 + 50}ms` }}
                    >
                      <path d="M5 3l5 5-5 5" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}