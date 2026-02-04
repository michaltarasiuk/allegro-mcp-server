import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getServerWithInternals } from '../mcp/server-internals.js';
import { logger } from '../utils/logger.js';

const serverStatus = {
  status: 'running' as 'running' | 'idle' | 'busy',
  uptime: 0,
  requestCount: 0,
  lastUpdated: new Date().toISOString(),
};
let statusUpdateInterval: NodeJS.Timeout | null = null;

export function startStatusUpdates(server: McpServer) {
  if (statusUpdateInterval) {
    return;
  }
  statusUpdateInterval = setInterval(() => {
    serverStatus.uptime += 10;
    serverStatus.requestCount += Math.floor(Math.random() * 5);
    const statuses: Array<'running' | 'idle' | 'busy'> = ['running', 'idle', 'busy'];
    serverStatus.status = statuses[Math.floor(Math.random() * 3)];
    serverStatus.lastUpdated = new Date().toISOString();
    try {
      getServerWithInternals(server).sendResourceUpdated?.({
        uri: 'status://server',
      });
      logger.debug('status_resource', {
        message: 'Status updated, notification sent',
        status: serverStatus.status,
        uptime: serverStatus.uptime,
      });
    } catch (error) {
      logger.error('status_resource', {
        message: 'Failed to send resource update notification',
        error: (error as Error).message,
      });
    }
  }, 10000);
  logger.info('status_resource', {
    message: 'Status update notifications started (every 10s)',
  });
}

export function stopStatusUpdates() {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
    logger.info('status_resource', {
      message: 'Status update notifications stopped',
    });
  }
}

export function incrementRequestCount() {
  serverStatus.requestCount++;
  serverStatus.lastUpdated = new Date().toISOString();
}

export const statusResource = {
  uri: 'status://server',
  name: 'Server Status',
  description:
    'Dynamic server status (subscribable resource with update notifications)',
  mimeType: 'application/json',
  handler: async () => {
    logger.debug('status_resource', { message: 'Server status requested' });
    const statusData = {
      ...serverStatus,
      timestamp: new Date().toISOString(),
    };
    return {
      contents: [
        {
          uri: 'status://server',
          mimeType: 'application/json',
          text: JSON.stringify(statusData, null, 2),
        },
      ],
    };
  },
};
