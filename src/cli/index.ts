#!/usr/bin/env node

import { run } from './commands';

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
