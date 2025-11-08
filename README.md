# Headlesshost MCP Server

A comprehensive Model Context Protocol (MCP) server that provides complete communication with the Headlesshost platform API endpoints. This server enables AI assistants to interact with all aspects of the Headlesshost platform including user management, content site operations, staging site management, content generation, analytics, and system administration.

## Demo

https://www.youtube.com/watch?v=xGGwcrI7gSo&feature=youtu.be

<a href="https://glama.ai/mcp/servers/@Headlesshost/mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Headlesshost/mcp-server/badge" alt="Kapiti Server MCP server" />
</a>

## Installation

1. Clone this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the server:
   ```bash
   npm run build
   ```

## Usage

### With Claude Desktop

Add this configuration to your Claude Desktop config file:

On a Mac (edit or create this file).

```bash
MacOS: ~/Library/Application Support/Claude/claude_desktop_config.json

Windows: %APPDATA%\Claude\claude_desktop_config.json
```

## For local development

```json
{
  "mcpServers": {
    "Headlesshost-cms": {
      "command": "node",
      "args": ["/path/to/Headlesshost-mcp/build/index.js"],
      "env": {
        "HEADLESSHOST_API_KEY": "your-auth-token"
      }
    }
  }
}
```

## For automated install via npx

```json
{
  "mcpServers": {
    "headlesshost-cms": {
      "command": "npx",
      "args": ["headlesshost-mcp-server"],
      "env": {
        "HEADLESSHOST_API_KEY": "sk_live_your_api_key"
      }
    }
  }
}
```

### With Other MCP Clients

This server is compatible with any MCP client including:

- VS Code with MCP extensions
- Zed Editor
- Continue.dev
- Custom MCP implementations

Configure your client to use:

- **Command**: `node`
- **Args**: `["/path/to/Headlesshost.mcp/build/index.js"]`
- **Environment**: Set `HEADLESSHOST_API_KEY`

### Development

Build the server:

```bash
npm run build
```

Run the server directly:

```bash
npm start
```

Run the MCP inspector for debugging:

```bash
npm run inspector
```

## Resources

The server provides 2 resources for configuration and monitoring:

- **API Configuration**: Current Headlesshost API settings and endpoints
- **API Health Status**: Real-time connectivity and health information

## Error Handling

The server includes comprehensive error handling with:

- API authentication validation
- Network connectivity checks
- Detailed error messages and troubleshooting information
- Graceful fallbacks for API timeouts

## Security

- API key authentication required for all operations
- Secure environment variable handling
- Request/response logging for audit trails
- Input validation and sanitization