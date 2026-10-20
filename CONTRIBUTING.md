# Contributing

Use Node.js 24+, run `npm ci`, then follow README.md for the local Pages, D1, R2 and scheduled Worker setup.

Before proposing a change run `npm test`, `npm run build`, and `npm run test:integration` with local Workers available. Keep API tenant checks and scope enforcement in the server. Include migrations for schema changes and update the public API guide/contract when routes change. Never add real customer data, tokens, `.dev.vars`, or runtime state to fixtures or commits.

Design work should preserve the existing dashboard workflow and use the shared UI components and Geist font. Keep the public landing page distinct from authenticated firm data.
