# Ask DCIAC: natural-language assistant, UI user stories

Status: built in `prototypes/access-control` (2026-11-23). Tests: `e2e/ask.spec.js`, one test
per story. Answers come from a built-in parser ("Demo answers"); a language model can replace
it through `setAskParser()` in `src/domain/ask.ts` without changing any gate.
Written 2026-11-23 from a UI designer's point of view. It turns the product user stories
for a natural-language assistant into screens, states, and acceptance criteria that fit the
DCIAC prototype as it stands (`prototypes/access-control`).

## Design goal

An operator types a question or an instruction in plain English, from any signed-in screen,
and gets a short answer they can check and act on without losing their place. The assistant
never does more than the signed-in user can do, and never skips a confirmation.

Three principles drive every story below:

1. **Answer in place, then link out.** The answer appears beside the current screen. Links
   open the real view (rack, device view, Control) so the assistant never becomes a second
   copy of the app.
2. **Show the evidence.** Every answer uses the same shape as the existing Explain panel:
   What happened, Evidence (timestamped), Likely cause with confidence. Operators already
   know how to read it.
3. **Propose, never perform.** Anything that changes state shows as a proposal card. The user
   confirms through the same control the UI already uses (for power, the Control
   confirmation dialog).

## Where it lives

| Surface | Desktop (1024 px and wider) | Phone (up to 767 px) |
|---|---|---|
| Entry point | "Ask" in the side menu, directly below Audit (decided by Vinu) | "Ask" as a fifth item in the bottom tab bar (Floor, Operate, Plan, Audit, Ask) |
| Panel | Right-side drawer, 400 px wide, pushes content (does not cover the alarm chip or the page heading). Between 768 and 980 px it slides over the page. | Full-height sheet over the current view, with a Close button top-right |
| Shortcut | `/` opens the panel when focus is not in a terminal, KVM console, or text field. The serial and KVM consoles keep every keystroke. | None |
| Context | The panel header shows what the assistant can see: "Looking at: Operate · Rack · A14 · GPU Tray 06" | Same, truncated to the last two parts |

Wireframe, desktop:

```
+--------+------------------------------------------+---------------------+
| Floor  | [P1 · 7 · 2 escalated]                   | Ask DCIAC        [x]|
| Operate| Operate · Rack                 [NOC]     | Looking at: Rack A14|
| Plan   | Rack  Port map  Control  Sessions ...    |---------------------|
| Audit  |                                          | You: why is tray 06 |
| Ask    |   (current view, unchanged)              |  alarming?          |
|        |                                          | +-----------------+ |
|        |                                          | | What happened   | |
|        |                                          | | Evidence  (3)   | |
|        |                                          | | Likely cause 92%| |
|        |                                          | | [Open serial]   | |
|        |                                          | +-----------------+ |
|        |                                          | Suggested:          |
|        |                                          | (Show Hall 1 P1s)   |
|        |                                          |---------------------|
|        |                                          | [Ask about DCIAC..] |
+--------+------------------------------------------+---------------------+
```

## Components

| Component | Purpose | Built from |
|---|---|---|
| Ask input | Single-line field that grows to 4 lines. Enter sends, Shift+Enter adds a line. | `--panel`, `--line`, `--focus` ring |
| Suggested questions | Up to 3 chips under an empty conversation, based on the current screen (for example "What's wrong in Hall 1?" on Floor). | Existing chip style |
| Answer card | Lead sentence, then the Explain layout (What happened, Evidence, Likely cause). Links to views. | `.explain` styles, reused |
| Result table | For list answers (alarms, halls, racks). Max 8 rows, then "Show all in Fleet". | Fleet table styles |
| Proposal card | Shows the action, targets and count, with Confirm and Cancel. | `--amber-soft` background, `--amber-ink` text |
| Refusal card | States what was refused and why (role, interlock, out of scope). No workaround offered. | `--reject-soft`, `--danger-ink` |
| Source line | "From alarm watch-tray-06 · ttyS8 · read 09:41:12". Under every answer. | `--text-xs`, `--muted` |
| Stale badge | "Reading 7 min old" when data is older than the limit. | `--warn-soft`, `--warn-ink` |
| Assistant tag | Marks assistant entries in Audit: "via Ask". | Small pill, `--nvidia-soft` |

No new colors. Every component uses the tokens already in `styles.css` and works in the NOC
(dark) theme.

## States the panel must design for

| State | What the user sees |
|---|---|
| Empty | One-line intro ("Ask about alarms, racks, power, and capacity.") and 3 suggested questions |
| Thinking | The question stays visible; a quiet "Reading DCIAC…" line with the sources being checked. No spinner over the page. |
| Answer | Answer card or result table, source line, follow-up chips |
| Ambiguous | "Which A14?" with the options as buttons (Hall 1 A14, Hall 3 A14) |
| Proposal | Proposal card, waiting for Confirm |
| Refused | Refusal card with the reason |
| Unknown | "DCIAC doesn't have that." and what it would need. Never a guess. |
| Error | "Ask is unavailable right now. Everything else works." The rest of the app is unaffected. |
| Demo mode (no API key) | Same panel; answers come from a scripted set and a small "Demo answers" tag shows in the header |

## User stories

Each story has a product goal and UI acceptance criteria. Stories 1, 2, 3, 11 and 12 are the
suggested first slice: read-only, useful on day one, and they prove grounding and audit
before any action ships.

### UI-1 Open Ask from anywhere

As an operator, I want one obvious place to ask a question on every screen, so I don't have
to remember where things live.

- The Ask button shows on every signed-in screen, in the same place, at 1440 px and 390 px.
- `/` opens the panel and focuses the input, except when focus is in a terminal, KVM console,
  or text field.
- Opening the panel never moves the alarm chip or pushes the page heading below the fold.
- Escape closes the panel and returns focus to the Ask button.

### UI-2 Ask about the current state

As a shift operator, I want to ask "What's wrong in Hall 1?" and get a ranked list, so I can
see the worst problem first.

- The answer is a result table: priority mark, asset, one-line cause, open time and escalation
  clock (the same text as the alarm list).
- P1 rows first. Each asset name links to its rack or device view.
- If nothing is open: "Hall 1 has no open alarms. Last reading 09:41." No empty table.

### UI-3 Explain an alarm

As an operator, I want to ask "Why is Tray 06 alarming?" and see the reasoning, so I can
trust it before I act.

- The answer card uses the Explain layout and matches what the alarm's Explain panel says.
- Evidence lines carry their timestamps. The matching line is highlighted the same way as
  in Explain.
- The best way in (from the device's Ways in table) shows as the card's primary button.

### UI-4 Navigate by asking

As any user, I want to say "Open rack A14 from the rear", so I get there without menus.

- The app navigates to the route; the panel stays open and confirms "Opened Rack A14, rear."
- The browser Back button returns to the previous view.
- Ambiguous names show the Ambiguous state, never a guess.

### UI-5 Fleet and capacity answers

As a data center manager, I want to ask capacity questions and get a table I can scan.

- Numbers show units in the column headers (kW, %, U) and match Fleet exactly.
- "Show in Fleet" opens Operate · Fleet with the same filter and sort.

### UI-6 Propose an action

As an operator, I want to say "Ack all P3 inlet alarms in Hall 1" and confirm once.

- A proposal card lists the targets (up to 8 by name, then "and 4 more") and the count.
- Confirm is a deliberate second step; Enter in the input never confirms a proposal.
- After Confirm, the card shows the result ("Acked 6 alarms") and the alarm list updates.
- Cancel leaves everything unchanged and says so.

### UI-7 Power requests hand off to Control

As a facilities manager, I want power requests to go through the normal confirmation, so a
misread sentence can't switch power.

- "Turn off outlet 7" shows a card with one button: "Open in Control". It opens Control with
  outlet 7 selected and the standard confirmation dialog. The panel has no power buttons.
- Bulk power requests show the Refused state with "Use Control to switch power."

### UI-8 Role limits are visible

As a viewer, I want to know why I can't do something, so I'm not left guessing.

- A request outside my role shows the Refused state naming the role needed.
- Buttons for actions I can't take are never shown, not just disabled.

### UI-9 Interlocks are explained, not overridden

As an operator, I want to understand a blocked action.

- With the DI-1 leak rope asserted, re-energize requests show the Refused state, name the
  interlock, and link to Control, where the interlock already shows. No override button exists.

### UI-10 Shift handover

As an incoming shift lead, I want to ask "What happened last shift?"

- Three sections in the answer: Resolved, Still open (with escalation clocks), Actions taken.
- A time window chip ("Last 12 h") that I can change.
- "Open in Audit" applies the same window and the "via Ask" filter.

### UI-11 Everything is in Audit

As a compliance owner, I want assistant activity in the existing Audit view.

- Each question, proposal, confirm or cancel, and result is an Audit row tagged "via Ask".
- Audit gets a filter chip: All, Manual, via Ask.

### UI-12 Honest and fresh

As an operator, I never want to act on an invented or old number.

- Every answer ends with a source line.
- Readings older than the limit show the stale badge on the number itself.
- Out-of-scope questions get a one-line decline in the Unknown state.

### UI-13 Device text can't drive the assistant

As a security owner, I want text from devices shown as data.

- Console lines, device names and notes show in monospace inside quotes in Evidence.
- A seeded hostile console line produces no proposal card (Playwright test).

### UI-14 Works on a phone and with a keyboard

As an operator on the floor with only a phone, I want the same answers.

- At 390 px the sheet fills the screen, the input sits above the keyboard, and result tables
  scroll sideways inside the card, never the page.
- The whole panel works by keyboard. Focus moves to each new answer's lead sentence, and the
  answer list is a polite live region.
- Text and controls meet WCAG AA contrast in both themes. Reduced-motion turns off the
  drawer slide.

## Demos to update when this ships

Per `DAILY_IMPROVEMENT.md`, visible changes update the demos:

- Full demo: one beat that asks "What's wrong in Hall 1?" with the spotlight on the panel.
- AI fix demo: ask "Why is Tray 05 down?" before opening the serial session.
- Executive briefing: one line on Ask and its guardrails.

## Test plan (Playwright)

- `ask.spec.js`: open by button and by `/`; `/` is ignored inside the serial terminal.
- Scripted answers for UI-2, UI-3, UI-4 match the alarm list, Explain and routes.
- UI-6 confirm and cancel; UI-7 opens Control with the dialog; UI-8 and UI-9 show refusals.
- UI-11 rows appear in Audit with the "via Ask" tag.
- UI-13 hostile text test.
- Layout checks at 1440 px and 390 px: heading and alarm chip stay above the fold.

## Decisions (Vinu, 2026-11-24)

| Question | Decision | Where it is |
|---|---|---|
| Where does Ask live? | Side menu, directly below Audit; fifth tab on phones | `src/ui/rail.ts` |
| Who gets Ask? | Operators (the Operator and Administrator roles). The read-only colo role has no Ask button and `/` does nothing. | `ASK_ROLES` in `src/ui/ask.ts` |
| Bulk non-power actions? | Allowed with no cap. Every one is still a proposal that waits for Confirm. Power is never bulk. | `ackProposal` in `src/ui/ask.ts` |
| Keep the conversation? | Yes, between logins and reloads, per user, last 30 turns, in this browser | `syncAskUser` in `src/ui/ask.ts` |
| Stale-data limit | 1 minute on the newest evidence line in an explanation | `STALE_MS` in `src/ui/ask.ts` |
| Model | A small self-hosted model. Scripted answers ("Demo answers") are fine for now. | Plan below |

## Plan: the self-hosted model

Not built yet; scripted answers stay until the model is hosted.

- **Job:** the model only turns a sentence into an `AskIntent` (kind plus hall, rack, device,
  outlet, filters). It never writes answers, never sees credentials, and never calls actions.
  Every answer and gate stays in DCIAC code, so a wrong parse can at worst show the wrong
  read-only answer or a proposal the operator declines.
- **Size and hosting:** a small instruction-tuned open-weights model (around 1–8B parameters,
  quantized) served on site by an OpenAI-compatible local server such as llama.cpp or vLLM.
  No data leaves the site.
- **Wiring:** `serve.py` gets one endpoint, `POST /api/v1/ask/parse`, that forwards the question
  with a fixed prompt and the `AskIntent` JSON schema to the local server and validates the reply.
  The front end calls `setAskParser()` with a parser that uses it and falls back to the scripted
  parser on error or timeout (target under 1 second).
- **Checks before switching:** run every question in `e2e/ask.spec.js` plus a set of reworded
  ones through both parsers and compare intents; keep the hostile-text test.
- **Open for Vinu:** which hardware it runs on, and which model family is allowed on site.

## As built: limits

- "Where can I fit…" answers at hall level from IT power headroom and feed state. Rack positions,
  cooling and floor space stay in Plan · Halls.
- Opening a session is a proposal; after Confirm, DCIAC's usual console check still runs (an
  in-progress work order outside a failover), so the card says "Requested", not "Opened".
- Escape inside a serial or KVM console stays with the console; use Close to leave Ask there.
- A saved conversation lives in this browser's storage. It does not follow the user to another
  browser or device.
