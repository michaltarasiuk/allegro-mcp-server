import { resolveConfig } from "../shared/config/env.js";

// Facade for app config + re-exports; barrel rule suppressed by design.
// biome-ignore lint/performance/noBarrelFile: intentional config facade
export {
  parseConfig,
  resolveConfig,
  type UnifiedConfig,
} from "../shared/config/env.js";

export const config = resolveConfig();
