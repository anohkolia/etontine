import { defineConfig } from 'drizzle-kit'
import { resolveSqliteFile } from './server/db/path.ts'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: resolveSqliteFile(),
  },
  strict: true,
  verbose: true,
})
