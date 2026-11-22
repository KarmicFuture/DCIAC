# UX backlog

Last audit: 2026-11-21 ([ux-auditor](166e146c-d610-462d-82f4-6a183d420a6d))  
Branch: `ux/2026-11-21-cycle`  
Reviewed from prototype source for http://localhost:5174/DCIAC/ (live browser pass was unavailable in the audit session).  
Ranked by severity, then effort (severity desc, effort asc).

| rank | issue | screen/file | severity | user impact | effort | status |
|---:|---|---|---:|---|---|---|
| 1 | Outlet confirmation is a modal without initial focus, focus containment, or Escape, while the Control page stays in the tab order, so keyboard and assistive-tech users can lose context or act behind a destructive power confirmation (WCAG 2.4.3, 2.1.1, 4.1.2) | Control · `prototypes/access-control/src/domain/outlet-policy.ts`, `prototypes/access-control/src/views/control.ts`, `prototypes/access-control/src/ui/render.ts` | 4 | Power Off/Cycle confirmation is unsafe and disorienting for non-pointer users | M | done — this cycle |
| 2 | Floor/site view depends on pointer picking, dragging, and non-focusable or `aria-hidden` clickable floor, pod, feed, and pipe elements, so keyboard and assistive-tech users cannot reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2) | Floor · `prototypes/access-control/src/views/floor.ts`, `prototypes/access-control/src/ui/render.ts` | 4 | Keyboard and assistive-tech operators are blocked from the main entry point | L | open — list slice shipped — docs/plans/2026-11-22-floor.md |
| 3 | Operate/Plan sub-navigation uses tab roles without tab interaction semantics, and the page heading stays “Operate” or “Plan” across Rack, Port map, Control, Sessions, One-line, and Fleet (WCAG 4.1.2, 1.3.1, 2.4.6) | Operate/Plan · `prototypes/access-control/src/ui/rail.ts` | 3 | Users cannot tell which screen they are on from the heading or tab state | S | done — PR #44 |
| 4 | Alarm banner nests action buttons inside summary/details controls, so name, role, and keyboard activation for P1 alarm actions are ambiguous (WCAG 4.1.2, 2.1.1, 1.3.1) | All signed-in screens · `prototypes/access-control/src/ui/alarms.ts`, `prototypes/access-control/src/ui/render.ts` | 3 | Operators may expand or collapse the banner instead of responding to the alarm | M | done — docs/plans/2026-11-22-alarm.md |
| 5 | KVM console is a focusable generic container with click-to-type and typed echo that is not named or described, so assistive-tech users cannot tell where keyboard input goes (WCAG 4.1.2, 1.3.1, 2.4.6) | Sessions · `prototypes/access-control/src/views/sessions.ts`, `prototypes/access-control/src/ui/render.ts` | 3 | KVM failover is opaque to screen-reader and some keyboard users | M | done — docs/plans/2026-11-22-kvm.md |
