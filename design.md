# UI/UX Direction — Axis

## Design intent

Axis is a focused clinical workflow tool, not a generic analytics dashboard. The interface should help each role identify the next safe action quickly, reduce ambiguity in study/report state, and keep clinical text comfortable to read.

## Visual language

- **Application chrome:** restrained, dark-first clinical workspace with a matching light theme.
- **Palette:** use semantic tokens from `apps/web/src/app/globals.css` (`background`, `surface`, `border`, `text`, `accent`, `warning`, `success`, `error`). Dark mode uses deep blue-gray surfaces with cyan accents; light mode uses cool neutral surfaces and a darker teal accent.
- **Urgency:** amber communicates elevated acuity; red is reserved for alerts/errors. Status and priority must also have text or icon labels.
- **Typography:** Inter for interface text, Inter Tight for headings, IBM Plex Mono for identifiers/data, and Source Serif 4 for report prose.
- **Report editor:** retain the light paper/editor surface in either theme, with dark ink and clear section structure. Do not make long-form clinical text low contrast.
- **Shape and density:** compact, structured worklist rows and panels; subtle borders; restrained corner radii; avoid decorative cards that compete with clinical content.

## Interaction principles

- Prioritize role-specific information architecture: hospital submission/tracking, radiologist worklist/reading/reporting, manager triage/review, and administrator operations.
- Keep high-frequency study actions discoverable and state changes explicit. Confirm consequential actions and show the result or error.
- Use consistent status, priority, and acuity affordances across worklist, reading, hospital tracking, and report views.
- Provide visible loading, empty, error, and success states; preserve user-entered work when a recoverable request fails.
- Support keyboard navigation and a visible focus ring. Respect `prefers-reduced-motion`; animation must not be required to notice STAT status.
- Avoid relying on color alone for priority, validity, errors, or workflow state.
- Do not imply that the application diagnoses images or that an AI feature is active when it is only a job record/placeholder.

## Responsive and desktop behavior

- Keep primary reading and report actions usable at common laptop resolutions; allow secondary metadata panels to collapse when space is constrained.
- Treat the Tauri client as the same remote web product, not as an offline mode or separate experience.
- Preserve the same-origin `/ohif` and `/api/dicom-web` path behavior required for authenticated image access.

## Clinical report editor

- Present a light, A4-style paper canvas with stable clinical sections, readable serif report text, and a compact accessible formatting toolbar.
- Keep patient/study identifiers and report state visible; include repeating page metadata and print-friendly output.
- Autosave must preserve the editor content on failure and communicate saving, saved, unsaved, and error states. Explicit save and sign-off controls remain distinct.
- Prior patient records belong in the reading context and must respect API-enforced assignment and hospital release boundaries.

## Existing implementation references

- Tokens, theme handling, focus styling, and reduced-motion rule: `apps/web/src/app/globals.css`.
- Tailwind semantic aliases and font families: `apps/web/tailwind.config.ts`.
- Shared layout: `apps/web/src/components/layout/`.
- Reading and report UI: `apps/web/src/components/reading/` and `apps/web/src/components/report/`.
- Study urgency indicator: `apps/web/src/components/ui/AcuityPulse.tsx`.

## Design acceptance checklist

- The screen makes current role, study identity, and workflow status clear.
- Critical actions are distinguishable from navigation and reversible actions.
- State indicators include text/accessible names, not just color.
- Focus, keyboard operation, reduced-motion, and readable contrast are preserved.
- No real PHI appears in design examples or static/demo data.
