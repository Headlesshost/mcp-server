# Headlesshost MCP Server

A comprehensive Model Context Protocol (MCP) server that provides complete communication with the Headlesshost platform API endpoints. This server enables AI assistants to interact with all aspects of the Headlesshost platform including user management, content site operations, staging site management, content generation, analytics, and system administration.

## Demo

https://www.youtube.com/watch?v=xGGwcrI7gSo&feature=youtu.be

## Features

### 🔧 General System Tools (4 tools)

- **Ping**: Test authentication and connection to the Headlesshost API
- **Health**: Check API health status and connectivity
- **Reference Data**: Access system reference data and lookups

### 📁 File Management (2 tools)

- **Upload Profile Image**: Upload user profile images
- **Upload Staging Site File**: Upload files to staging sites

### 👥 Membership Management (8 tools)

- **User Registration**: Register new users with account creation
- **User Management**: Full CRUD operations for users with claims/roles support
- **Account Management**: View and update account information

### 🏢 Content Site Management (6 tools)

- **Content Site Creation**: Create new content site entities
- **Content Site Listing**: View all content sites with optional filters
- **Content Site Details**: Get comprehensive content site information
- **Content Site Updates**: Modify content site settings and configuration
- **Content Site Deletion**: Remove content sites from the platform

### 🌐 Staging Site Management (67 tools)

Comprehensive staging site functionality including:

#### Core Operations (4 tools)

- **Site Operations**: Update, delete, publish staging sites
- **Site Information**: Get staging site details and metadata
- **Site Management**: Clone, promote, and revert staging sites
- **Published Sites**: Access published site versions

#### Page Management (4 tools)

- **Page CRUD**: Create, read, update, delete staging site pages
- **Page Content**: Handle page content and structure
- **Page Analytics**: Track page-level performance
- **Page Logs**: Monitor page activity and changes

#### Section Management (6 tools)

- **Section CRUD**: Create, read, update, delete page sections
- **Section Content**: Manage section-specific content
- **Section Logs**: Track section-level modifications

#### User Management (5 tools)

- **User Access Control**: Grant and manage user access to staging sites
- **Role Management**: Assign and update user roles per site
- **Permissions**: Configure granular user permissions
- **User Listing**: View all site users and their roles

#### Business Operations (7 tools)

- **Business Logs**: Access business activity and audit trails
- **Business Analytics**: Business-level performance metrics
- **User Management**: Business user access and permissions
- **Role Management**: Business role definitions and assignments

#### System Resources (8 tools)

- **Hit Tracking**: Raw analytics data and visitor metrics
- **System Health**: Monitor platform connectivity and status

## 📈 Total Coverage

**87 Tools** providing complete API coverage across all Headlesshost platform functionality!

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

## Configuration

Set up your environment variables:

```bash
export HEADLESSHOST_API_KEY="your-auth-token"
```

Or create a `.env` file:

```env
HEADLESSHOST_API_KEY=your-auth-token
```

## Usage

### With Claude Desktop

Add this configuration to your Claude Desktop config file:

On a Mac (edit or create this file).

```bash
/Users/warren/Library/Application Support/Claude/claude_desktop_config.json
```

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
