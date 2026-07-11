# Agent Instructions

* Create a new branch for each feature using `feat/{feature-name}`, unless the task is explicitly meant for the current branch.
* Leave completed work uncommitted. 
* Run relevant tests (if possible) before declaring a chunk complete. Notify me when a discrete chunk is ready, and I will review and commit it manually.
* Use higher-intelligence models for planning and review. Use cheaper, lower-compute models for straightforward implementation, upgrading after repeated failure or when the task requires deeper reasoning.
* Keep documentation changes proportional to the request. Update docs only when a shipped feature, refactor, or architecture change creates a concrete future-maintenance obligation, when an existing runbook/spec becomes factually wrong, or when the user asks for docs. Do not update for a small tweak unless crossing off a todo or revising inaccurate information.
* Treat instruction and tool-package files as implementation dependencies, not project documentation. Do not edit anything under `.claude/skills/`, `.agents/skills/`, or other skill-package directories during ordinary feature work. Change those files only when explicitly repairing, customizing, or reinstalling that skill; never add progress notes or feature-specific edits inside them.
* `DESIGN.md` is the visual-system source of truth. Update it only when the visual system itself changes, not for one-off component tweaks that already follow the system.
* Leave completed work uncommitted. Run relevant tests when possible and report discrete chunks for manual review.
