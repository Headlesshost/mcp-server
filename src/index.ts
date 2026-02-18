#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { z } from "zod";
import axios, { AxiosResponse } from "axios";
import FormData from "form-data";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

// Configuration
const API_BASE_URL = "https://api.headlesshost.com";
const LEGACY_API_KEY = process.env.HEADLESSHOST_API_KEY?.trim();
const ALLOW_LEGACY_API_KEY_FALLBACK = (process.env.ALLOW_LEGACY_API_KEY_FALLBACK || "true").toLowerCase() !== "false";
const MCP_AUTH_MODE = (process.env.MCP_AUTH_MODE || "none").toLowerCase(); // none | oauth | mixed
const MCP_OIDC_ISSUER_URL = process.env.MCP_OIDC_ISSUER_URL?.trim() || process.env.TOOLS_OIDC_ISSUER_URL?.trim();
const MCP_OIDC_AUDIENCE = process.env.MCP_OIDC_AUDIENCE?.trim() || process.env.TOOLS_OIDC_AUDIENCE?.trim();
const MCP_OIDC_SCOPES = (process.env.MCP_OIDC_SCOPES || "kapiti.read kapiti.write kapiti.admin")
  .split(" ")
  .map((s) => s.trim())
  .filter(Boolean);
const TOKEN_VERIFY_CACHE_TTL_MS = Number(process.env.MCP_TOKEN_VERIFY_CACHE_TTL_MS || "60000");

const tokenVerifyCache = new Map<string, { expiresAt: number; authInfo: { clientId: string; scopes: string[]; expiresAt?: number } }>();

function getApiClient(ctx: any) {
  const accessToken = resolveAccessToken(ctx);

  // Content-Type is NOT set by default so FormData uploads can provide their own boundary.
  // Axios will set Content-Type: application/json for plain object payloads.
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    timeout: 30000,
  });
}

function resolveAccessToken(ctx: any): string | undefined {
  const authInfoToken = ctx?.authInfo?.token;
  if (typeof authInfoToken === "string" && authInfoToken.length > 0) {
    return authInfoToken;
  }

  if (ALLOW_LEGACY_API_KEY_FALLBACK && LEGACY_API_KEY) {
    return LEGACY_API_KEY;
  }

  return undefined;
}

// Types for Headlesshost API responses
interface ApiResponse {
  success: boolean;
  data?: any;
  message?: string;
  statusCode?: number;
}

// Create MCP server
const server = new McpServer(
  {
    name: "headlesshost-tools-server",
    version: "1.3.1",
  },
  {
    capabilities: {
      logging: {},
    },
  },
);

// Helper function to handle API errors and send structured log to client
function handleApiError(error: any): string {
  if (error.response) {
    return `API Error ${error.response.status}: ${error.response.data?.message || error.response.statusText}`;
  } else if (error.request) {
    return "Network Error: Unable to reach API server";
  } else {
    return `Error: ${error.message}`;
  }
}

async function logError(message: string): Promise<void> {
  try {
    await server.server.sendLoggingMessage({ level: "error", data: message });
  } catch {
    // Client may not support logging; silently ignore
  }
}

function parseJwtClaims(token: string): Record<string, any> {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

async function buildOAuthMetadata(): Promise<OAuthMetadata | null> {
  if (!MCP_OIDC_ISSUER_URL) return null;

  const issuer = MCP_OIDC_ISSUER_URL.replace(/\/+$/, "");
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`Unable to load OIDC metadata from issuer (${response.status})`);
  }

  const oidc = (await response.json()) as any;
  if (!oidc.issuer || !oidc.authorization_endpoint || !oidc.token_endpoint) {
    throw new Error("OIDC discovery document is missing required OAuth fields");
  }

  return {
    issuer: String(oidc.issuer),
    authorization_endpoint: String(oidc.authorization_endpoint),
    token_endpoint: String(oidc.token_endpoint),
    registration_endpoint: oidc.registration_endpoint ? String(oidc.registration_endpoint) : undefined,
    scopes_supported: Array.isArray(oidc.scopes_supported) ? oidc.scopes_supported : MCP_OIDC_SCOPES,
    response_types_supported: Array.isArray(oidc.response_types_supported) ? oidc.response_types_supported : ["code"],
    response_modes_supported: Array.isArray(oidc.response_modes_supported) ? oidc.response_modes_supported : undefined,
    grant_types_supported: Array.isArray(oidc.grant_types_supported) ? oidc.grant_types_supported : undefined,
    token_endpoint_auth_methods_supported: Array.isArray(oidc.token_endpoint_auth_methods_supported) ? oidc.token_endpoint_auth_methods_supported : undefined,
    token_endpoint_auth_signing_alg_values_supported: Array.isArray(oidc.token_endpoint_auth_signing_alg_values_supported)
      ? oidc.token_endpoint_auth_signing_alg_values_supported
      : undefined,
    service_documentation: oidc.service_documentation ? String(oidc.service_documentation) : undefined,
    revocation_endpoint: oidc.revocation_endpoint ? String(oidc.revocation_endpoint) : undefined,
    revocation_endpoint_auth_methods_supported: Array.isArray(oidc.revocation_endpoint_auth_methods_supported)
      ? oidc.revocation_endpoint_auth_methods_supported
      : undefined,
    revocation_endpoint_auth_signing_alg_values_supported: Array.isArray(oidc.revocation_endpoint_auth_signing_alg_values_supported)
      ? oidc.revocation_endpoint_auth_signing_alg_values_supported
      : undefined,
    introspection_endpoint: oidc.introspection_endpoint ? String(oidc.introspection_endpoint) : undefined,
    introspection_endpoint_auth_methods_supported: Array.isArray(oidc.introspection_endpoint_auth_methods_supported)
      ? oidc.introspection_endpoint_auth_methods_supported
      : undefined,
    introspection_endpoint_auth_signing_alg_values_supported: Array.isArray(oidc.introspection_endpoint_auth_signing_alg_values_supported)
      ? oidc.introspection_endpoint_auth_signing_alg_values_supported
      : undefined,
    code_challenge_methods_supported: Array.isArray(oidc.code_challenge_methods_supported) ? oidc.code_challenge_methods_supported : ["S256"],
    client_id_metadata_document_supported: Boolean(oidc.client_id_metadata_document_supported),
  };
}

async function verifyBearerToken(token: string) {
  const now = Date.now();
  const cached = tokenVerifyCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.authInfo;
  }

  const claims = parseJwtClaims(token);
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  const clientId = String(claims.client_id || claims.azp || claims.sub || claims.email || "unknown");
  const expiresAt = typeof claims.exp === "number" ? claims.exp : undefined;

  const response = await axios.get(`${API_BASE_URL}/tools/ping`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    throw new Error(response.data?.message || `Token validation failed with status ${response.status}`);
  }

  const authInfo = { clientId, scopes, expiresAt };
  tokenVerifyCache.set(token, { authInfo, expiresAt: now + TOKEN_VERIFY_CACHE_TTL_MS });
  return authInfo;
}

// ========== GENERAL TOOLS ENDPOINTS ==========

// Ping - Test authentication and connection
server.registerTool(
  "ping",
  {
    title: "Ping API",
    description: "Test authentication and connection to the Headlesshost API",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_args, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get("/tools/ping");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Health - Check API health status
server.registerTool(
  "health",
  {
    title: "Health Check",
    description: "Check the health status of the Headlesshost API",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_args, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get("/tools/health");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Reference Data
server.registerTool(
  "get_ref_data",
  {
    title: "Get Reference Data",
    description: "Get system reference data and lookups for global use. For sections types call the get_staging_site_configuration endpoint.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_args, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/system/refdata`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== MEMBERSHIP MANAGEMENT TOOLS ==========

// Create User
server.registerTool(
  "create_user",
  {
    title: "Create User",
    description: "Create a new user in the current account",
    inputSchema: {
      email: z.string().email().describe("User email address"),
      firstName: z.string().describe("User first name"),
      lastName: z.string().describe("User last name"),
      password: z.string().optional().describe("User password"),
      claims: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("User roles/claims (string or array of strings)"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ email, firstName, lastName, password, claims }, ctx) => {
    try {
      // Build payload object more carefully
      const payload: any = {
        email,
        firstName,
        lastName,
      };

      // Only add password if provided
      if (password) {
        payload.password = password;
      }

      // Only add claims if provided and convert to array format
      if (claims !== undefined && claims !== null) {
        if (typeof claims === "string") {
          payload.claims = [claims];
        } else if (Array.isArray(claims) && claims.length > 0) {
          payload.claims = claims;
        }
        // If claims is an empty array or invalid, don't include it in payload
      }

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post("/tools/membership/users", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get User
server.registerTool(
  "get_user",
  {
    title: "Get User",
    description: "Get user details by ID",
    inputSchema: {
      id: z.string().describe("User ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ id }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/membership/users/${id}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update User
const validClaims = ["Administrator", "PageCreator", "PageEditor", "PageDeleter", "PageMover", "SectionCreator", "SectionEditor", "SectionDeleter", "SectionMover", "ContentDesigner", "Publisher", "BusinessDeleter", "BusinessEditor", "BusinessCreator", "PublishApproval", "PublishDeleter", "Super", "StageCreator", "StageDeleter", "SiteMerger", "CatalogCreator", "CatalogEditor", "CatalogDeleter", "BusinessUserCreator", "BusinessUserEditor", "BusinessUserDeleter"] as const;

server.registerTool(
  "update_user",
  {
    title: "Update User",
    description: "Update user information",
    inputSchema: {
      id: z.string().describe("User ID"),
      email: z.string().email().optional().describe("User email"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      claims: z
        .union([z.enum(validClaims), z.array(z.enum(validClaims))])
        .optional()
        .describe(`User roles/claims (choose from: ${validClaims.join(", ")})`),
    },
    annotations: { destructiveHint: false },
  },
  async ({ id, email, firstName, lastName, claims }, ctx) => {
    try {
      const payload: any = {};
      if (email) payload.email = email;
      if (firstName) payload.firstName = firstName;
      if (lastName) payload.lastName = lastName;

      if (claims !== undefined && claims !== null) {
        // Normalize to array
        payload.claims = Array.isArray(claims) ? claims : [claims];
      }

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/membership/users/${id}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete User
server.registerTool(
  "delete_user",
  {
    title: "Delete User",
    description: "Delete a user from the system",
    inputSchema: {
      id: z.string().describe("User ID"),
      reason: z.string().optional().describe("Reason for deletion"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ id, reason }, ctx) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/membership/users/${id}`, {
        data: payload,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Create account
server.registerTool(
  "create_account",
  {
    title: "Create Account",
    description: "Create a new user account in the system",
    inputSchema: {
      email: z.string().email().describe("User email address"),
      password: z.string().describe("User password"),
      firstName: z.string().optional().describe("User first name"),
      lastName: z.string().optional().describe("User last name"),
      accountName: z.string().optional().describe("Account name to create"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ email, password, firstName, lastName, accountName }, ctx) => {
    try {
      const payload = { email, password, firstName, lastName, accountName };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post("/tools/membership/register", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Account
server.registerTool(
  "get_account",
  {
    title: "Get Account",
    description: "Get current account information",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_args, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/membership/account`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Account
server.registerTool(
  "update_account",
  {
    title: "Update Account",
    description: "Update account information",
    inputSchema: {
      name: z.string().optional().describe("Account name"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ name }, ctx) => {
    try {
      const payload: any = {};
      if (name) payload.name = name;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put("/tools/membership/account", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== FILE MANAGEMENT TOOLS ==========

// Upload User Profile Image
server.registerTool(
  "upload_user_profile_image",
  {
    title: "Upload User Profile Image",
    description: "Upload a profile image for a user",
    inputSchema: {
      userId: z.string().describe("User ID"),
      image: z.string().describe("Base64 encoded file data"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ userId, image }, ctx) => {
    try {
      const payload = { image };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/files/users/${userId}/profile-image`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Upload Staging Site File
server.registerTool(
  "upload_staging_site_file",
  {
    title: "Upload Staging Site File",
    description: "Upload a file to a staging site",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      file: z.string().describe("Base64 encoded file data"),
      filename: z.string().optional().describe("Original filename"),
      mimetype: z.string().optional().describe("File MIME type"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, file, filename, mimetype }, ctx) => {
    try {
      // Strip data URI prefix if present (e.g. "data:application/pdf;base64,...")
      const base64Data = file.includes(",") ? file.split(",")[1] : file;
      const buffer = Buffer.from(base64Data, "base64");

      const formData = new FormData();
      formData.append("file", buffer, {
        filename: filename || "uploaded-file.txt",
        contentType: mimetype || "application/octet-stream",
      });

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/files/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/files`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Upload Staging Site Image
server.registerTool(
  "upload_staging_site_image",
  {
    title: "Upload Staging Site Image",
    description: "Upload an image to a staging site",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      file: z.string().describe("Base64 encoded file data"),
      filename: z.string().optional().describe("Original filename"),
      mimetype: z.string().optional().describe("File MIME type"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, file, filename, mimetype }, ctx) => {
    try {
      // Strip data URI prefix if present (e.g. "data:image/png;base64,...")
      const base64Data = file.includes(",") ? file.split(",")[1] : file;
      const buffer = Buffer.from(base64Data, "base64");

      const formData = new FormData();
      formData.append("file", buffer, {
        filename: filename || "uploaded-image.jpg",
        contentType: mimetype || "image/jpeg",
      });

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/files/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/images`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== CONTENT SITE MANAGEMENT TOOLS ==========

// Create Content Site
server.registerTool(
  "create_content_site",
  {
    title: "Create Content Site",
    description: "Create a new content site in the current account",
    inputSchema: {
      name: z.string().describe("Content site name"),
      sampleDataId: z.string().optional().describe("Optional sample data ID to initialize the site. The sample data list can be found in the ref data."),
    },
    annotations: { destructiveHint: false },
  },
  async ({ name, sampleDataId }, ctx) => {
    try {
      const payload = { name, sampleDataId };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post("/tools/content-sites", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Content Sites
server.registerTool(
  "get_content_sites",
  {
    title: "Get Content Sites",
    description: "Get all content sites in the current account",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({}, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Content Site
server.registerTool(
  "get_content_site",
  {
    title: "Get Content Site",
    description: "Get content site details by ID. Returns site configuration, associated staging sites (workingSites), recent published versions (publishedSites), and team access information.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Content Site
server.registerTool(
  "update_content_site",
  {
    title: "Update Content Site",
    description: "Update content site information",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      name: z.string().optional().describe("Content Site Name"),
      contactEmail: z.string().optional().describe("Content Site Contact Email"),
      billingEmail: z.string().optional().describe("Content Site Billing Email"),
      addressLine1: z.string().optional().describe("Content Site Address Line 1"),
      addressLine2: z.string().optional().describe("Content Site Address Line 2"),
      city: z.string().optional().describe("Content Site City"),
      state: z.string().optional().describe("Content Site State"),
      country: z.string().optional().describe("Content Site Country"),
      postalCode: z.string().optional().describe("Content Site Postal Code"),
      productionUrl: z.string().optional().describe("Content Site Production URL"),
      repoUrl: z.string().optional().describe("Content Site Repository URL"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, name, contactEmail, billingEmail, addressLine1, addressLine2, city, state, country, postalCode, productionUrl, repoUrl }, ctx) => {
    try {
      const payload: any = {};
      if (name) payload.name = name;
      if (contactEmail) payload.contactEmail = contactEmail;
      if (billingEmail) payload.billingEmail = billingEmail;
      if (addressLine1) payload.addressLine1 = addressLine1;
      if (addressLine2) payload.addressLine2 = addressLine2;
      if (city) payload.city = city;
      if (state) payload.state = state;
      if (country) payload.country = country;
      if (postalCode) payload.postalCode = postalCode;
      if (productionUrl) payload.productionUrl = productionUrl;
      if (repoUrl) payload.repoUrl = repoUrl;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete Content Site
server.registerTool(
  "delete_content_site",
  {
    title: "Delete Content Site",
    description: "Delete a content site",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      reason: z.string().optional().describe("Reason for deletion"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ contentSiteId, reason }, ctx) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/content-sites/${contentSiteId}`, {
        data: payload,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== STAGING SITE MANAGEMENT TOOLS ==========

// Update Staging Site
server.registerTool(
  "update_staging_site",
  {
    title: "Update Staging Site",
    description: "Update staging site information",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      name: z.string().optional().describe("Staging site name"),
      locale: z.string().optional().describe("Staging site default locale"),
      isHead: z.boolean().describe("Is the default staging site"),
      content: z.record(z.any()).optional().describe("Staging site content"),
      stageUrl: z.string().optional().describe("Staging site stage URL"),
      guideUrl: z.string().optional().describe("Staging site guide URL"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, name, locale, isHead, content, stageUrl, guideUrl }, ctx) => {
    try {
      const payload: any = {};
      if (name) payload.name = name;
      if (locale) payload.locale = locale;
      if (isHead) payload.isHead = isHead;
      if (content) payload.content = content;
      if (stageUrl) payload.stageUrl = stageUrl;
      if (guideUrl) payload.guideUrl = guideUrl;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete Staging Site
server.registerTool(
  "delete_staging_site",
  {
    title: "Delete Staging Site",
    description: "Delete a staging site",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      reason: z.string().optional().describe("Reason for deletion"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ contentSiteId, stagingSiteId, reason }, ctx) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}`, {
        data: payload,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Publish Staging Site
server.registerTool(
  "publish_staging_site",
  {
    title: "Publish Staging Site",
    description: "Publish a staging site to make it live. This creates a new published version from the current staging site state. The comments field should describe what changed in this publish. Set isApproved to true to make it the production version, or false for a publication that is ready to be approved. Optionally specify a publishAt date to schedule the publish for the future, or a previewUrl if this publish is being reviewed in an external system.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      comments: z.string().describe("Message for this publish"),
      isApproved: z.boolean().describe("Is the publish approved"),
      publishAt: z.date().optional().describe("When to publish the staging site"),
      previewUrl: z.string().optional().describe("Preview URL for the staging site"),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  async ({ contentSiteId, stagingSiteId, comments, isApproved, publishAt, previewUrl }, ctx) => {
    try {
      const payload = { comments, isApproved, publishAt, previewUrl };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/publish`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site
server.registerTool(
  "get_staging_site",
  {
    title: "Get Staging Site",
    description: "Get staging site details by ID. Returns comprehensive staging site information including configured locales, segments, and site-level audiences (without content). This is the source of truth for available locales and segments when creating audiences. The site-level audience metadata includes audience IDs, locale, and segment — use these IDs with get_staging_site_audience to retrieve full audience content.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Settings
server.registerTool(
  "get_staging_site_settings",
  {
    title: "Get Staging Site Settings",
    description: "Get staging site settings and metadata without content. Returns site configuration including locales, segments, and audience metadata. This is a lightweight alternative to get_staging_site that excludes section and page content. Use this when you only need to look up available locales and segments (e.g. before creating audiences). Also returns the current user's permissions (userPermissions) for the content site, which indicates which tools and operations the user is authorized to perform.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/settings`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Staging Site Locales
server.registerTool(
  "update_staging_site_locales",
  {
    title: "Update Staging Site Locales",
    description: "Update the locales configured on a staging site. Locales define the available languages/regions for audience targeting. Provide the full list of locale values — any existing locales not in the list will be removed. Use get_staging_site_settings to see currently configured locales. Requires Administrator access on the content site.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      baseLocale: z.string().describe("The default base locale for the staging site (e.g. 'en-US')"),
      locales: z.array(z.string()).describe("Array of locale values to configure (e.g. ['fr-GG', 'es-ES']). Any existing locales not in this list will be removed."),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, baseLocale, locales }, ctx) => {
    try {
      const payload = { baseLocale, locales };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/locales`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Staging Site Segments
server.registerTool(
  "update_staging_site_segments",
  {
    title: "Update Staging Site Segments",
    description: "Update the segments configured on a staging site. Segments define marketing or user groups for audience targeting. Each segment has a code (max 6 chars) and a description. Provide the full list of segments — any existing segments not in the list will be removed. Use get_staging_site_settings to see currently configured segments. Requires Administrator access on the content site.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      segments: z.array(z.object({
        code: z.string().describe("Segment code (max 6 characters, e.g. 'YOUTH')"),
        description: z.string().describe("Segment description (e.g. 'Youth demographic aged 18-25')"),
      })).describe("Array of segments to configure. Any existing segments not in this list will be removed."),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, segments }, ctx) => {
    try {
      const payload = { segments };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/segments`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Pages
server.registerTool(
  "get_staging_site_pages",
  {
    title: "Get Staging Site Pages",
    description: "Get staging site pages by ID",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Configuration
server.registerTool(
  "get_staging_site_configuration",
  {
    title: "Get Staging Site Configuration",
    description: "Get staging site configuration by ID. Returns the section schemas (sectionSchema) and type schemas (typeSchema) that define the available section types and their content structure. Use this to understand what fields are required when creating or updating sections.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/configuration`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Logs
server.registerTool(
  "get_staging_site_logs",
  {
    title: "Get Staging Site Logs",
    description: "Change logs since last publish",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/logs`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Published Sites
server.registerTool(
  "get_published_sites",
  {
    title: "Get Published Sites",
    description: "Get published sites for a content site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/published-sites`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Revert Staging Site
server.registerTool(
  "revert_staging_site",
  {
    title: "Revert Staging Site",
    description: "Revert a staging site to its last published state. This discards all unpublished changes across all pages and sections in the staging site.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      reason: z.string().optional().describe("Reason for reversion"),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async ({ contentSiteId, stagingSiteId, reason }, ctx) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/revert`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Clone Staging Site
server.registerTool(
  "clone_staging_site",
  {
    title: "Clone Staging Site",
    description: "Clone a staging site to create a new staging site with the same content. Useful for creating a working copy to make changes without affecting the original staging site.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      newName: z.string().optional().describe("Name for the cloned site"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, newName }, ctx) => {
    try {
      const payload = { newName };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/clone`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== WORKING SITE SECTION MANAGEMENT TOOLS ==========

// Create Staging Site Section
server.registerTool(
  "create_staging_site_section",
  {
    title: "Create Staging Site Section",
    description: "Create a new section in a staging site page. The sectionType must be one of the types defined in the staging site configuration. Use get_staging_site_configuration to retrieve the available section types and their content schemas before creating sections.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionType: z.string().describe("Section type"),
      content: z.record(z.any()).optional().describe("Section content which is a JSON object. The structure depends on the section type defined in the schema. The schema can be retrieved using the get_staging_site_configuration tool."),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionType, content }, ctx) => {
    try {
      const payload = { sectionType, content };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Section
server.registerTool(
  "get_staging_site_section",
  {
    title: "Get Staging Site Section",
    description: "Get details of a staging site section. The response includes a metadata list of all audiences created for this section (without audience content). Each audience entry includes its ID, locale, and segment. Use these IDs with get_staging_site_section_audience to retrieve or with update_staging_site_section_audience to update the full audience content.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Staging Site Section
server.registerTool(
  "update_staging_site_section",
  {
    title: "Update Staging Site Section",
    description: "Update a staging site section. The content structure must match the section's type schema. Use get_staging_site_configuration to retrieve the schema, or get_staging_site_section to see the current content structure before updating.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      content: z.record(z.any()).optional().describe("Section content which is a JSON object. The structure depends on the section type defined in the schema. The schema can be retrieved using the get_staging_site_configuration tool."),
      order: z.number().optional().describe("Section order"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, content, order }, ctx) => {
    try {
      const payload: any = {};
      if (content) payload.content = content;
      if (order !== undefined) payload.order = order;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete Staging Site Section
server.registerTool(
  "delete_staging_site_section",
  {
    title: "Delete Staging Site Section",
    description: "Delete a staging site section",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Publish Staging Site Section
server.registerTool(
  "publish_staging_site_section",
  {
    title: "Publish Staging Site Section",
    description: "Publish a staging site section",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      publishMessage: z.string().optional().describe("Message for this publish"),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, publishMessage }, ctx) => {
    try {
      const payload = { publishMessage };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/publish`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Revert Staging Site Section
server.registerTool(
  "revert_staging_site_section",
  {
    title: "Revert Staging Site Section",
    description: "Revert a staging site section to its last published state. This discards all unpublished changes to the section.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/revert`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Section Logs
server.registerTool(
  "get_staging_site_section_logs",
  {
    title: "Get Staging Site Section Logs",
    description: "Get logs for a staging site section since the last publish. Note: the sectionId parameter requires the section's Common ID (CID), not the regular section ID.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section Common ID (CID)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/logs`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== WORKING SITE PAGE MANAGEMENT TOOLS ==========

// Create Staging Site Page
server.registerTool(
  "create_staging_site_page",
  {
    title: "Create Staging Site Page",
    description: "Create a new page in a staging site. The identifier is used as the page's URL slug and must be unique within the staging site. The content field accepts page-level metadata as a JSON object (e.g. tags, extended properties).",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      title: z.string().describe("Page title"),
      identifier: z.string().describe("Page identifier"),
      content: z.record(z.any()).optional().describe("Page content"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, title, identifier, content }, ctx) => {
    try {
      const payload = { title, identifier, content };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Revert Staging Site
server.registerTool(
  "revert_staging_site_page",
  {
    title: "Revert Staging Site",
    description: "Revert a staging site page to its last published state. This discards all unpublished changes to the page.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      reason: z.string().optional().describe("Reason for reversion"),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async ({ contentSiteId, stagingSiteId, reason, pageId }, ctx) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/revert`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Page
server.registerTool(
  "get_staging_site_page",
  {
    title: "Get Staging Site Page",
    description: "Get details of a staging site page. Set includeSections to true to retrieve the page's sections list (IDs, types, and order — not full content). To get full section content, call get_staging_site_section for each section. The response includes a previewUrl to view the page in a browser. Each section in the list includes audience metadata (IDs, locale, segment — without content) that can be used with get_staging_site_section_audience to retrieve full audience content.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      includeSections: z.boolean().describe("Include page sections"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, includeSections }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}`, {
        params: { ...(includeSections && { includeSections: "true" }) },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Staging Site Page
server.registerTool(
  "update_staging_site_page",
  {
    title: "Update Staging Site Page",
    description: "Update a staging site page",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      title: z.string().describe("Page title"),
      identifier: z.string().describe("Page identifier"),
      order: z.number().optional().describe("Page order"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, title, identifier, order }, ctx) => {
    try {
      const payload: any = {};
      if (title) payload.title = title;
      if (identifier) payload.identifier = identifier;
      if (order !== undefined) payload.order = order;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete Staging Site Page
server.registerTool(
  "delete_staging_site_page",
  {
    title: "Delete Staging Site Page",
    description: "Delete a staging site page",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ contentSiteId, stagingSiteId, pageId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Staging Site Page Logs
server.registerTool(
  "get_staging_site_page_logs",
  {
    title: "Get Staging Site Page Logs",
    description: "Get the change logs for a staging site page since the last publish. Note: the pageId parameter requires the page's Common ID (CID), not the regular page ID.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page common ID (CID)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/logs`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== ContentSite ANALYTICS & ADMIN TOOLS ==========

// Get ContentSite Logs
server.registerTool(
  "get_content_site_logs",
  {
    title: "Get ContentSite Logs",
    description: "Get the last 15 activity logs for a content site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/logs`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get ContentSite Hits (Analytics)
server.registerTool(
  "get_content_site_hits",
  {
    title: "Get ContentSite Hits",
    description: "Get daily hits for a content site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/hits`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get ContentSite Users
server.registerTool(
  "get_content_site_accounts",
  {
    title: "Get ContentSite Accounts",
    description: "Get accounts associated with a content site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/accounts`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Content site Claims
server.registerTool(
  "get_content_site_claims",
  {
    title: "Get Content site Claims",
    description: "Get current user claims for the content site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/claims`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== STAGING SITE AUDIENCE MANAGEMENT TOOLS ==========

// Create Site Audience
server.registerTool(
  "create_staging_site_audience",
  {
    title: "Create Staging Site Audience",
    description: "Create a new audience for a staging site. Audiences allow you to target content to specific locale and segment combinations. The localeId and segmentId must reference locales and segments that are already configured on the staging site. Use get_staging_site_settings to retrieve the available locales and segments before creating audiences.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      localeId: z.string().optional().describe("Locale ID for the audience"),
      segmentId: z.string().optional().describe("Segment ID for the audience (optional - omit for default segment)"),
      content: z.record(z.any()).optional().describe("Audience content as a JSON object"),
      type: z.string().optional().describe("Audience type: Header, Footer, or Globals (for site-level audiences)"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, localeId, segmentId, content, type }, ctx) => {
    try {
      const payload: any = {};
      if (localeId) payload.localeId = localeId;
      if (segmentId) payload.segmentId = segmentId;
      if (content) payload.content = content;
      if (type) payload.type = type;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/audiences`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Site Audience
server.registerTool(
  "get_staging_site_audience",
  {
    title: "Get Staging Site Audience",
    description: "Get details of a specific staging site audience by ID, including full audience content. To find available audience IDs, check the audiences metadata list returned by get_staging_site.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      audienceId: z.string().describe("Audience ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, audienceId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/audiences/${audienceId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Site Audience
server.registerTool(
  "update_staging_site_audience",
  {
    title: "Update Staging Site Audience",
    description: "Update an existing staging site audience. The audience's locale and segment must reference locales and segments that are already configured on the staging site. Use get_staging_site_settings to retrieve the available locales and segments.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      audienceId: z.string().describe("Audience ID"),
      content: z.record(z.any()).optional().describe("Updated audience content as a JSON object"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, audienceId, content }, ctx) => {
    try {
      const payload: any = {};
      if (content) payload.content = content;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/audiences/${audienceId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete Site Audience
server.registerTool(
  "delete_staging_site_audience",
  {
    title: "Delete Staging Site Audience",
    description: "Delete a staging site audience. Note: the base audience (default locale with no segment) cannot be deleted.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      audienceId: z.string().describe("Audience ID"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ contentSiteId, stagingSiteId, audienceId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/audiences/${audienceId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== STAGING SITE SECTION AUDIENCE MANAGEMENT TOOLS ==========

// Create Section Audience
server.registerTool(
  "create_staging_site_section_audience",
  {
    title: "Create Staging Site Section Audience",
    description: "Create a new audience override for a specific section. This allows you to customize section content for a specific locale/segment combination. The localeId and segmentId must reference locales and segments that are already configured on the staging site. Use get_staging_site_settings to retrieve the available locales and segments before creating section audiences.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      localeId: z.string().optional().describe("Locale ID for the audience"),
      segmentId: z.string().optional().describe("Segment ID for the audience (optional - omit for default segment)"),
      content: z.record(z.any()).optional().describe("Section audience content as a JSON object"),
      excluded: z.boolean().optional().describe("Whether this section should be excluded for this audience"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, localeId, segmentId, content, excluded }, ctx) => {
    try {
      const payload: any = {};
      if (localeId) payload.localeId = localeId;
      if (segmentId) payload.segmentId = segmentId;
      if (content) payload.content = content;
      if (excluded !== undefined) payload.excluded = excluded;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/audiences`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Get Section Audience
server.registerTool(
  "get_staging_site_section_audience",
  {
    title: "Get Staging Site Section Audience",
    description: "Get details of a specific section audience by ID, including full audience content. To find available audience IDs, check the audiences metadata list returned by get_staging_site_section.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      audienceId: z.string().describe("Audience ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, audienceId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/audiences/${audienceId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Update Section Audience
server.registerTool(
  "update_staging_site_section_audience",
  {
    title: "Update Staging Site Section Audience",
    description: "Update an existing section audience override. The audience's locale and segment must reference locales and segments that are already configured on the staging site. Use get_staging_site_settings to retrieve the available locales and segments.",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      audienceId: z.string().describe("Audience ID"),
      content: z.record(z.any()).optional().describe("Updated section audience content as a JSON object"),
      excluded: z.boolean().optional().describe("Whether this section should be excluded for this audience"),
    },
    annotations: { destructiveHint: false },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, audienceId, content, excluded }, ctx) => {
    try {
      const payload: any = {};
      if (content) payload.content = content;
      if (excluded !== undefined) payload.excluded = excluded;

      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/audiences/${audienceId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// Delete Section Audience
server.registerTool(
  "delete_staging_site_section_audience",
  {
    title: "Delete Staging Site Section Audience",
    description: "Delete a section audience override",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      audienceId: z.string().describe("Audience ID"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, audienceId }, ctx) => {
    try {
      const response: AxiosResponse<ApiResponse> = await getApiClient(ctx).delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/audiences/${audienceId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = handleApiError(error);
      await logError(message);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  },
);

// ========== RESOURCES ==========

// Register a resource for API configuration
server.registerResource(
  "api_config",
  "config://api",
  {
    title: "Headlesshost API Configuration",
    description: "Current Headlesshost API configuration and available endpoints",
    mimeType: "application/json",
  },
  async (_uri, ctx) => {
    const config = {
      baseUrl: API_BASE_URL,
      allowsLegacyApiKeyFallback: ALLOW_LEGACY_API_KEY_FALLBACK,
      hasLegacyApiKey: !!LEGACY_API_KEY,
      hasRequestAccessToken: !!ctx?.authInfo?.token,
      endpoints: {
        general: {
          ping: "GET /tools/ping - Test authentication and connection",
        },
        membership: {
          createUser: "POST /tools/membership/users - Create user",
          createUserProfileImage: "POST /tools/files/users/:id/profile-image - Update user image",
          getUser: "GET /tools/membership/users/:id - Get user details",
          updateUser: "PUT /tools/membership/users/:id - Update user",
          deleteUser: "DELETE /tools/membership/users/:id - Delete user",
          createAccount: "POST /tools/membership/register - Create account with user",
          getAccount: "GET /tools/membership/account - Get account info",
          updateAccount: "PUT /tools/membership/account - Update account",
        },
        contentSite: {
          createContentSite: "POST /tools/content-sites - Create content site",
          getContentSites: "GET /tools/content-sites - Get content sites",
          getContentSite: "GET /tools/content-sites/:id - Get content site details",
          getContentSiteLogs: "GET /tools/content-sites/:contentSiteId/logs - Get content site logs",
          getContentSiteHits: "GET /tools/content-sites/:contentSiteId/hits - Get content site analytics",
          getContentSiteUsers: "GET /tools/content-sites/:contentSiteId/users - Get content site users",
          getContentSiteClaims: "GET /tools/content-sites/:contentSiteId/claims - Get content site claims",
        },
        stagingSites: {
          createStagingSite: "POST /tools/content-sites/:contentSiteId/staging-sites - Create staging site",
          getStagingSite: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId - Get staging site details",
          getStagingSitePages: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages - Get staging site pages",
          getStagingSiteConfiguration: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/configuration - Get staging site configuration, including section types (BusinessSections) available for pages",
          updateStagingSite: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId - Update staging site",
          deleteStagingSite: "DELETE /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId - Delete staging site",
          publishStagingSite: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/publish - Publish staging site",
          revertStagingSite: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/revert - Revert staging site",
          cloneStagingSite: "POST /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/clone - Clone staging site",
          getStagingSiteLogs: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/logs - Get staging site logs",
          getPublishedSites: "GET /tools/content-sites/:contentSiteId/published-sites - Get published sites",
          createStagingSiteImage: "POST /tools/files/content-sites/:contentSiteId/staging-sites/:stagingSiteId/images - Create staging site image",
          createStagingSiteFile: "POST /tools/files/content-sites/:contentSiteId/staging-sites/:stagingSiteId/files - Create staging site file",
        },
        stagingSitePages: {
          createStagingSitePage: "POST /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages - Create staging site page",
          getStagingSitePage: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId - Get staging site page",
          updateStagingSitePage: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId - Update staging site page",
          revertStagingSitePage: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/revert - Revert staging site page",
          deleteStagingSitePage: "DELETE /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId - Delete staging site page",
          getStagingSitePageLogs: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/logs - Get staging site page logs",
        },
        stagingSiteSections: {
          createStagingSiteSection: "POST /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections - Create staging site section",
          getStagingSiteSection: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId - Get staging site section",
          updateStagingSiteSection: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId - Update staging site section",
          deleteStagingSiteSection: "DELETE /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId - Delete staging site section",
          publishStagingSiteSection: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/publish - Publish staging site section",
          revertStagingSiteSection: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/revert - Revert staging site section",
          getStagingSiteSectionLogs: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/logs - Get staging site section logs",
        },
        stagingSiteAudiences: {
          createStagingSiteAudience: "POST /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/audiences - Create staging site audience",
          getStagingSiteAudience: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/audiences/:audienceId - Get staging site audience",
          updateStagingSiteAudience: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/audiences/:audienceId - Update staging site audience",
          deleteStagingSiteAudience: "DELETE /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/audiences/:audienceId - Delete staging site audience",
          createStagingSiteSectionAudience: "POST /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/audiences - Create section audience",
          getStagingSiteSectionAudience: "GET /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/audiences/:audienceId - Get section audience",
          updateStagingSiteSectionAudience: "PUT /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/audiences/:audienceId - Update section audience",
          deleteStagingSiteSectionAudience: "DELETE /tools/content-sites/:contentSiteId/staging-sites/:stagingSiteId/pages/:pageId/sections/:sectionId/audiences/:audienceId - Delete section audience",
        },
        system: {
          getRefData: "GET /tools/system/refdata - Get reference data",
        },
      },
    };

    return {
      contents: [
        {
          uri: "config://api",
          text: JSON.stringify(config, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  },
);

// Register a resource for API health status
server.registerResource(
  "api_health",
  "health://api",
  {
    title: "Headlesshost API Health Status",
    description: "Current health status and connectivity information for the Headlesshost API",
    mimeType: "application/json",
  },
  async (_uri, ctx) => {
    try {
      const startTime = Date.now();
      const response = await getApiClient(ctx).get("/tools/ping");
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      const healthInfo = {
        status: "healthy",
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
        apiUrl: API_BASE_URL,
        authenticated: response.status === 200,
        serverResponse: response.data,
      };

      return {
        contents: [
          {
            uri: "health://api",
            text: JSON.stringify(healthInfo, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    } catch (error) {
      const healthInfo = {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        apiUrl: API_BASE_URL,
        error: error instanceof Error ? error.message : "Unknown error",
        authenticated: false,
      };

      return {
        contents: [
          {
            uri: "health://api",
            text: JSON.stringify(healthInfo, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  },
);

// Start the server
async function startStdioMode() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with the JSON-RPC protocol on stdout
  console.error("Headlesshost MCP Server started successfully");
  console.error("Transport: stdio");
  console.error(`API Base URL: ${API_BASE_URL}`);
  console.error(`Legacy API key fallback enabled: ${ALLOW_LEGACY_API_KEY_FALLBACK}`);
  console.error(`Legacy API key configured: ${!!LEGACY_API_KEY}`);
}

async function startHttpMode() {
  const port = Number(process.env.MCP_PORT || "3001");
  const host = process.env.MCP_HOST || "127.0.0.1";
  const publicBaseUrl = process.env.MCP_PUBLIC_BASE_URL || `http://${host}:${port}/mcp`;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  const app = createMcpExpressApp({ host });

  const resourceServerUrl = new URL(publicBaseUrl);
  if (MCP_AUTH_MODE !== "none") {
    if (!MCP_OIDC_ISSUER_URL) {
      throw new Error("MCP_AUTH_MODE is oauth/mixed but MCP_OIDC_ISSUER_URL is not configured");
    }
    const oauthMetadata = await buildOAuthMetadata();
    if (!oauthMetadata) {
      throw new Error("Unable to resolve OAuth metadata");
    }
    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl,
        scopesSupported: MCP_OIDC_SCOPES,
        resourceName: "Headlesshost MCP",
      }),
    );

    // Compatibility endpoints some clients probe directly.
    app.get("/.well-known/openid-configuration", (_req: any, res: any) => res.json(oauthMetadata));
    app.get("/.well-known/oauth-authorization-server", (_req: any, res: any) => res.json(oauthMetadata));
    app.get("/mcp/.well-known/openid-configuration", (_req: any, res: any) => res.json(oauthMetadata));
    app.get("/mcp/.well-known/oauth-authorization-server", (_req: any, res: any) => res.json(oauthMetadata));
    app.get("/.well-known/openid-configuration/mcp", (_req: any, res: any) => res.json(oauthMetadata));
    app.get("/.well-known/oauth-authorization-server/mcp", (_req: any, res: any) => res.json(oauthMetadata));
  }

  const mcpHandler = async (req: any, res: any) => {
    try {
      if ((req.method || "GET").toUpperCase() === "POST") {
        await transport.handleRequest(req, res, (req as any).body);
        return;
      }
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("HTTP transport error:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  };

  const authMiddleware =
    MCP_AUTH_MODE === "oauth"
      ? requireBearerAuth({
          verifier: {
            verifyAccessToken: async (token) => {
              const info = await verifyBearerToken(token);
              return {
                token,
                clientId: info.clientId,
                scopes: info.scopes,
                expiresAt: info.expiresAt,
                extra: { audience: MCP_OIDC_AUDIENCE },
              };
            },
          },
          requiredScopes: [],
          resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
        })
      : null;

  const mixedAuthMiddleware = async (req: any, res: any, next: any) => {
    const authHeader = req.headers?.authorization;
    if (!authHeader || typeof authHeader !== "string") {
      next();
      return;
    }

    try {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const info = await verifyBearerToken(token);
      req.auth = {
        token,
        clientId: info.clientId,
        scopes: info.scopes,
        expiresAt: info.expiresAt,
      };
      next();
    } catch {
      res.status(401).json({
        error: "invalid_token",
        error_description: "Bearer token is invalid",
      });
    }
  };

  if (authMiddleware) {
    app.post("/mcp", authMiddleware, mcpHandler as any);
    app.get("/mcp", authMiddleware, mcpHandler as any);
    app.delete("/mcp", authMiddleware, mcpHandler as any);
  } else if (MCP_AUTH_MODE === "mixed") {
    app.post("/mcp", mixedAuthMiddleware, mcpHandler as any);
    app.get("/mcp", mixedAuthMiddleware, mcpHandler as any);
    app.delete("/mcp", mixedAuthMiddleware, mcpHandler as any);
  } else {
    app.post("/mcp", mcpHandler as any);
    app.get("/mcp", mcpHandler as any);
    app.delete("/mcp", mcpHandler as any);
  }

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    httpServer.on("error", reject);
  });

  console.error("Headlesshost MCP Server started successfully");
  console.error("Transport: streamable-http");
  console.error(`MCP endpoint: ${publicBaseUrl}`);
  console.error(`MCP auth mode: ${MCP_AUTH_MODE}`);
  console.error(`MCP OIDC issuer configured: ${!!MCP_OIDC_ISSUER_URL}`);
  console.error(`MCP OIDC audience configured: ${!!MCP_OIDC_AUDIENCE}`);
  console.error(`API Base URL: ${API_BASE_URL}`);
  console.error(`Legacy API key fallback enabled: ${ALLOW_LEGACY_API_KEY_FALLBACK}`);
  console.error(`Legacy API key configured: ${!!LEGACY_API_KEY}`);
}

async function main() {
  const transportMode = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
  if (transportMode === "http") {
    await startHttpMode();
    return;
  }

  await startStdioMode();
}

main().catch((error) => {
  console.error("Unhandled error in main:", error);
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.error("Shutting down Headlesshost MCP Server...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("Shutting down Headlesshost MCP Server...");
  process.exit(0);
});
