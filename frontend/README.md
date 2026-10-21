# BeamBi dashboard

React, TypeScript, Vite, and Tailwind. See the repository README for setup,
offline operation, hardware configuration, and validation commands.

Pages: Home, Alignment, Link Details, Hardware, Logs, Display Settings.
`src/lib/socket.ts` owns the shared authenticated Socket.IO connection.
`src/hooks/useTelemetry.ts` expires stale readings before displaying them as
live or using them for alignment audio. `src/types.ts` re-exports the backend
API contract. Display thresholds are browser preferences; device controls live
on Hardware. The UI uses installed system fonts and local assets for offline use.
