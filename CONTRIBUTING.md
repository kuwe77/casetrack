# Contributing

1. Fork the repository and create a focused branch.
2. Use Node.js 24 or newer, run `npm ci`, then `npm run dev`.
3. Use fictional data and a separate `CASETRACK_DATA_DIR` for development. Never commit database files, exports, encryption keys or real client information.
4. Keep the app local-first and preserve the local-access and encryption boundaries described in SECURITY.md. Changes to the cryptographic format need explicit versioning and a migration plan.
5. Use the existing shadcn/ui primitives and theme tokens. Check light/dark themes, keyboard interaction and narrow screens.
6. Run `npm test` and `npm run build`. Add meaningful regression coverage for behavior or security changes.
7. Open a pull request explaining the problem, the change and how it was verified.

Use issues for reproducible bugs and scoped feature proposals. Security reports belong in the private reporting channel described in SECURITY.md.
