# Headlesshost MCP Server

A Model Context Protocol (MCP) server that provides complete communication with the Headlesshost platform API. This server enables AI assistants to manage content sites, staging sites, pages, sections, audiences, users, and file uploads through the Headlesshost platform.

Built with `@modelcontextprotocol/sdk` v1.26 and includes tool annotations, structured logging, and Zod input validation.

## Demo

https://www.youtube.com/watch?v=xGGwcrI7gSo&feature=youtu.be

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

The server requires a Headlesshost API key set via the `HEADLESSHOST_API_KEY` environment variable.

## Usage

### With Claude Desktop

Add this configuration to your Claude Desktop config file:

```bash
MacOS: ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%\Claude\claude_desktop_config.json
```

#### Local development

```json
{
  "mcpServers": {
    "headlesshost-cms": {
      "command": "node",
      "args": ["/path/to/kapiti.mcp/build/index.js"],
      "env": {
        "HEADLESSHOST_API_KEY": "your-auth-token"
      }
    }
  }
}
```

#### Via npx

```json
{
  "mcpServers": {
    "headlesshost-cms": {
      "command": "npx",
      "args": ["headlesshost-mcp-server"],
      "env": {
        "HEADLESSHOST_API_KEY": "your-auth-token"
      }
    }
  }
}
```

### With Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "headlesshost-cms": {
      "command": "node",
      "args": ["/path/to/kapiti.mcp/build/index.js"],
      "env": {
        "HEADLESSHOST_API_KEY": "your-auth-token"
      }
    }
  }
}
```

### With Other MCP Clients

This server is compatible with any MCP client including VS Code, Zed Editor, Continue.dev, and custom MCP implementations.

Configure your client to use:

- **Command**: `node`
- **Args**: `["/path/to/kapiti.mcp/build/index.js"]`
- **Environment**: Set `HEADLESSHOST_API_KEY`

## Tools (53)

All tools include MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) to help clients present appropriate UI and confirmation prompts.

### General (3)

| Tool           | Description                           |
| -------------- | ------------------------------------- |
| `ping`         | Test authentication and connection    |
| `health`       | Check API health status               |
| `get_ref_data` | Get system reference data and lookups |

### User Management (4)

| Tool          | Description                              |
| ------------- | ---------------------------------------- |
| `create_user` | Create a new user in the current account |
| `get_user`    | Get user details by ID                   |
| `update_user` | Update user information and claims       |
| `delete_user` | Delete a user from the system            |

### Account Management (3)

| Tool             | Description                     |
| ---------------- | ------------------------------- |
| `create_account` | Create a new user account       |
| `get_account`    | Get current account information |
| `update_account` | Update account information      |

### File Uploads (3)

| Tool                        | Description                       |
| --------------------------- | --------------------------------- |
| `upload_user_profile_image` | Upload a profile image for a user |
| `upload_staging_site_file`  | Upload a file to a staging site   |
| `upload_staging_site_image` | Upload an image to a staging site |

### Content Sites (5)

| Tool                  | Description                          |
| --------------------- | ------------------------------------ |
| `create_content_site` | Create a new content site            |
| `get_content_sites`   | Get all content sites in the account |
| `get_content_site`    | Get content site details by ID       |
| `update_content_site` | Update content site information      |
| `delete_content_site` | Delete a content site                |

### Staging Sites (9)

| Tool                             | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `update_staging_site`            | Update staging site information                        |
| `delete_staging_site`            | Delete a staging site                                  |
| `publish_staging_site`           | Publish a staging site to make it live                 |
| `get_staging_site`               | Get staging site details                               |
| `get_staging_site_pages`         | Get staging site pages                                 |
| `get_staging_site_configuration` | Get staging site configuration including section types |
| `get_staging_site_logs`          | Get change logs since last publish                     |
| `get_published_sites`            | Get published sites for a content site                 |
| `revert_staging_site`            | Revert a staging site to a previous state              |
| `clone_staging_site`             | Clone a staging site                                   |

### Pages (6)

| Tool                         | Description                               |
| ---------------------------- | ----------------------------------------- |
| `create_staging_site_page`   | Create a new page                         |
| `get_staging_site_page`      | Get page details (with optional sections) |
| `update_staging_site_page`   | Update a page                             |
| `delete_staging_site_page`   | Delete a page                             |
| `revert_staging_site_page`   | Revert a page to a previous state         |
| `get_staging_site_page_logs` | Get page change logs since last publish   |

### Sections (7)

| Tool                            | Description                                |
| ------------------------------- | ------------------------------------------ |
| `create_staging_site_section`   | Create a new section in a page             |
| `get_staging_site_section`      | Get section details                        |
| `update_staging_site_section`   | Update a section                           |
| `delete_staging_site_section`   | Delete a section                           |
| `publish_staging_site_section`  | Publish a single section                   |
| `revert_staging_site_section`   | Revert a section to a previous state       |
| `get_staging_site_section_logs` | Get section change logs since last publish |

### Site Audiences (4)

| Tool                           | Description                                                |
| ------------------------------ | ---------------------------------------------------------- |
| `create_staging_site_audience` | Create an audience (locale/segment combination) for a site |
| `get_staging_site_audience`    | Get audience details                                       |
| `update_staging_site_audience` | Update an audience                                         |
| `delete_staging_site_audience` | Delete an audience (base audience cannot be deleted)       |

### Section Audiences (4)

| Tool                                   | Description                               |
| -------------------------------------- | ----------------------------------------- |
| `create_staging_site_section_audience` | Create an audience override for a section |
| `get_staging_site_section_audience`    | Get section audience details              |
| `update_staging_site_section_audience` | Update a section audience override        |
| `delete_staging_site_section_audience` | Delete a section audience override        |

### Analytics (4)

| Tool                        | Description                   |
| --------------------------- | ----------------------------- |
| `get_content_site_logs`     | Get the last 15 activity logs |
| `get_content_site_hits`     | Get daily hit analytics       |
| `get_content_site_accounts` | Get associated accounts       |
| `get_content_site_claims`   | Get current user claims       |

## Resources

The server provides 2 resources for configuration and monitoring:

- **API Configuration** (`config://api`) — Available endpoints and current settings
- **API Health Status** (`health://api`) — Real-time connectivity and response time

## Development

Build the server:

```bash
npm run build
```

Run in development mode:

```bash
npm run dev
```

Watch for changes:

```bash
npm run watch
```

Run the MCP inspector for debugging:

```bash
npm run inspector
```

## Error Handling

The server includes structured error handling:

- API authentication validation
- Network connectivity checks
- Structured logging via MCP logging capability (errors are sent to the client)
- Graceful fallbacks for API timeouts

## Security

- API key authentication required for all operations
- Secure environment variable handling
- Input validation via Zod schemas on all tool inputs
- Tool annotations signal destructive operations to clients
