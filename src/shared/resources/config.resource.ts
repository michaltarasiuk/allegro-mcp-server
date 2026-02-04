import type { UnifiedConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { redactSensitiveData } from '../utils/security.js';

export function createConfigResource(config: UnifiedConfig) {
  return {
    uri: 'config://server',
    name: 'Server Configuration',
    description: 'Current server configuration (sensitive data redacted)',
    mimeType: 'application/json',
    handler: async () => {
      logger.debug('config_resource', { message: 'Server configuration requested' });
      const safeConfig = redactSensitiveData(config as Record<string, unknown>);
      return {
        contents: [
          {
            uri: 'config://server',
            mimeType: 'application/json',
            text: JSON.stringify(safeConfig, null, 2),
          },
        ],
      };
    },
  };
}

export const configResource = {
  uri: 'config://server',
  name: 'Server Configuration',
  description: 'Current server configuration (sensitive data redacted)',
  mimeType: 'application/json',
  handler: async () => {
    throw new Error('Use createConfigResource(config) to initialize this resource');
  },
};
