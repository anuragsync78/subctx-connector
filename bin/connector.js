#!/usr/bin/env node

/**
 * Subctx Sanctuary Client Connector
 * Stdio-to-HTTP JSON-RPC 2.0 Bridge for Model Context Protocol (MCP)
 *
 * Connects standard MCP clients (Claude Desktop, Cursor, Windsurf, Cline, etc.)
 * directly to the Subctx Sanctuary remote endpoint: https://sanctuary.subctx.com/v1/mcp
 */

import readline from 'node:readline';

const VERSION = '1.2.0';
const DEFAULT_ENDPOINT = 'https://sanctuary.subctx.com/v1/mcp';
const endpoint = process.env.SUBCTX_ENDPOINT || DEFAULT_ENDPOINT;

// Handle command-line arguments for quick inspection
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`@subctx/connector v${VERSION}`);
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Subctx Sanctuary MCP Client Connector
Usage:
  npx -y @subctx/connector [options]

Options:
  -v, --version       Print version
  -h, --help          Show help

Environment Variables:
  SUBCTX_ENDPOINT     Override endpoint (default: ${DEFAULT_ENDPOINT})
  SUBCTX_DEBUG        Enable debug logging to stderr
  `);
  process.exit(0);
}

const isDebug = Boolean(process.env.SUBCTX_DEBUG);
function debugLog(...args) {
  if (isDebug) {
    process.stderr.write(`[subctx-connector] ${args.join(' ')}\n`);
  }
}

debugLog(`Initialized Subctx Connector -> ${endpoint}`);

let pendingRequests = 0;
let isClosed = false;

function checkExit() {
  if (isClosed && pendingRequests === 0) {
    debugLog('All pending requests completed and stdin closed. Exiting.');
    process.exit(0);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    debugLog('Invalid JSON received on stdin:', trimmed);
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${err.message}`
      }
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    return;
  }

  const isNotification = parsed.id === undefined || parsed.id === null;

  pendingRequests++;
  try {
    debugLog(`Forwarding method "${parsed.method}" (id: ${parsed.id}) to ${endpoint}`);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `subctx-connector/${VERSION}`
      },
      body: JSON.stringify(parsed)
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();

    // If client sent a notification, MCP does not expect a response
    if (!isNotification) {
      process.stdout.write(JSON.stringify(json) + '\n');
    }
  } catch (err) {
    debugLog(`Error forwarding request: ${err.message}`);
    if (!isNotification) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: parsed.id ?? null,
        error: {
          code: -32603,
          message: `Bridge internal error: ${err.message}`
        }
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  } finally {
    pendingRequests--;
    checkExit();
  }
});

rl.on('close', () => {
  isClosed = true;
  checkExit();
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
