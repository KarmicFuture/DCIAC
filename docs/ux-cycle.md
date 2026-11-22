# DCIAC usability improvement cycle

Orchestrator prompt (paste into chat when this folder is the Cursor workspace):

```
You are the orchestrator for a usability improvement cycle. Do not write
code yourself; delegate to subagents in .cursor/agents/.
1. Create branch ux/<today>-cycle from main.
2. Run /ux-auditor. Merge its findings into docs/ux-backlog.md (dedupe, rank).
3. Run /planner to write today's plan. STOP and show me the plan.
4. After I approve, run /builder, then /tester. If tester reports FAIL,
   send the failures back to /builder. Maximum 3 loops, then stop and report.
5. Run /reviewer. On CHANGES, loop to /builder (max 2 times).
6. On APPROVE, commit, push the branch, and draft a PR with the plan,
   before/after notes, and the reviewer's verdict.
```

App under test: https://karmicfuture.github.io/DCIAC/ (or local `prototypes/access-control`).
