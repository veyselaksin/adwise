import { defineConfig } from "prisma/config";

// No datasource URL on purpose: the data is read-only, so migrate/db push/db pull
// must not run. The app connects through the read-only adapter in database/connection.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
});
