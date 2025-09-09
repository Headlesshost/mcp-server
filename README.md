# Headlesshost MCP Server

A comprehensive Model Context Protocol (MCP) server that provides complete communication with the Headlesshost platform API endpoints. This server enables AI assistants to interact with all aspects of the Headlesshost platform including user management, content site operations, staging site management, content generation, analytics, and system administration.

## Demo

https://www.youtube.com/watch?v=xGGwcrI7gSo&feature=youtu.be

## Features

### 🔧 General System Tools (4 tools)

- **Ping**: Test authentication and connection to the Headlesshost API
- **Health**: Check API health status and connectivity
- **GPT Assistant**: Access AI assistance for various tasks
- **Reference Data**: Access system reference data and lookups

### 📁 File Management (2 tools)

- **Upload Profile Image**: Upload user profile images
- **Upload Staging Site File**: Upload files to staging sites

### 👥 Membership Management (8 tools)

- **User Registration**: Register new users with account creation
- **User Management**: Full CRUD operations for users with claims/roles support
- **Account Management**: View and update account information
- **Team Management**: Create and manage teams within accounts

### 🏢 Content Site Management (6 tools)

- **Content Site Creation**: Create new content site entities
- **Content Site Listing**: View all content sites with optional filters
- **Content Site Details**: Get comprehensive content site information
- **Content Site Updates**: Modify content site settings and configuration
- **Content Site Deletion**: Remove content sites from the platform
- **Site Login**: Authenticate and access content sites

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
- **Section Publishing**: Publish and revert individual sections
- **Section Content**: Manage section-specific content
- **Section Logs**: Track section-level modifications

#### User Management (5 tools)

- **User Access Control**: Grant and manage user access to staging sites
- **Role Management**: Assign and update user roles per site
- **Permissions**: Configure granular user permissions
- **User Listing**: View all site users and their roles

#### Audience Management (6 tools)

- **Audience Segmentation**: Define and manage site audiences
- **Audience Analytics**: Track audience engagement and behavior
- **Audience Targeting**: Configure audience-specific content delivery
- **Audience Insights**: Generate detailed audience reports

#### Catalog Management (5 tools)

- **Content Catalogs**: Organize and manage content libraries
- **Product Catalogs**: Handle e-commerce and product data
- **Media Libraries**: Manage digital assets and resources
- **Catalog Organization**: Structure and categorize catalog items

#### Style Guide Management (5 tools)

- **Brand Guidelines**: Define and maintain visual consistency
- **Style Systems**: Create reusable design components
- **Design Standards**: Establish consistent design patterns
- **Brand Assets**: Organize and manage brand resources

#### Content Generation & Merging (3 tools)

- **AI Content Creation**: Generate site content using AI assistance
- **Section-Specific Generation**: Create targeted section content
- **Content Merging**: Combine and merge content between sites

#### Template Management (5 tools)

- **Template Creation**: Build reusable site templates
- **Template Library**: Manage and organize template collections
- **Template Sharing**: Share templates across content sites
- **Template Organization**: Categorize and structure templates

#### Analytics & Reporting (4 tools)

- **Site Analytics**: Comprehensive staging site performance metrics
- **Page Analytics**: Individual page performance tracking
- **Audience Analytics**: Detailed audience behavior insights
- **Real-time Metrics**: Current site activity and engagement data

#### Business Operations (7 tools)

- **Business Logs**: Access business activity and audit trails
- **Business Analytics**: Business-level performance metrics
- **User Management**: Business user access and permissions
- **Role Management**: Business role definitions and assignments
- **Invoice Management**: Access and manage business invoices
- **Billing Integration**: Stripe checkout and payment processing
- **Subscription Management**: Handle subscription lifecycles and cancellations

#### System Resources (8 tools)

- **Hit Tracking**: Raw analytics data and visitor metrics
- **Pricing Information**: Access available pricing plans
- **Checkout Management**: Handle payment session status
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
export HEADLESSHOST_BASE_URL="https://api.Headlesshost.com"
export HEADLESSHOST_API_KEY="your-auth-token"
```

Or create a `.env` file:

```env
HEADLESSHOST_BASE_URL=https://api.Headlesshost.com
HEADLESSHOST_API_KEY=your-auth-token
```

## Usage

### With Claude Desktop

Add this configuration to your Claude Desktop config file:

```json
{
  "mcpServers": {
    "Headlesshost-cms": {
      "command": "node",
      "args": ["/path/to/Headlesshost.mcp/build/index.js"],
      "env": {
        "HEADLESSHOST_BASE_URL": "https://api.Headlesshost.com",
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
- **Environment**: Set `HEADLESSHOST_BASE_URL` and `HEADLESSHOST_API_KEY`

### Development

Build the server:

```bash
npm run build
```

Run the server directly:

```bash
npm start
```

Test the server:

```bash
npx tsx tests/test-client.ts
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
