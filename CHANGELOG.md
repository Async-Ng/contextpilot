# Changelog

## 0.3.0 - Public beta

### Added

- `contextpilot setup` as the recommended one-time project setup command.
- Prescriptive orchestration control plane with run/step state, role guidance, and trace events.
- Invisible agent protocol so humans can chat normally while agents run ContextPilot commands.
- Step-aware gate enforcement for active orchestration runs.
- `fullstack-to-srs` module-folder output layout for Sections 03, 06, 07, and 08.
- Backward-compatible SRS ingest for both nested module folders and legacy flat files.
- Node test suite covering setup, orchestration, gate behavior, SRS ingest, and package readiness.

### Changed

- Public identity renamed to `ContextPilot`.
- Package and CLI binary are both `contextpilot`.
- Project storage moved to `.contextpilot/`, with setup migration from legacy `.harness/`.
- README quick start now uses the `contextpilot` npm package name.

### Notes

- This is a public beta release.
- Hook support still depends on each agent's available hook surface.
- Copilot and Windsurf remain commit-backstop oriented where direct hook support is limited.
