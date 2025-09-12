#!/usr/bin/env node

// Suppress console output during dotenv loading
const originalConsoleLog = console.log;
console.log = () => {};

import dotenv from "dotenv";
dotenv.config();

// Restore console.log for debugging purposes
console.log = originalConsoleLog;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosResponse } from "axios";
import FormData from "form-data";

// Configuration
const API_BASE_URL = "https://api.headlesshost.com";
const API_KEY = process.env.HEADLESSHOST_API_KEY || "YOUR API KEY HERE";
// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
  },
  timeout: 30000,
});

// Types for Headlesshost API responses
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  statusCode?: number;
}

// Auth context interface
interface AuthUser {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

// Common command/query interface
interface IAuthContext {
  _user: AuthUser;
}

// Membership entities
interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

interface Account {
  id: string;
  name: string;
  description?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  createdAt: string;
  updatedAt: string;
}

interface Team {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ContentSite entities
interface ContentSite {
  id: string;
  name: string;
  description?: string;
  accountId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StagingSite {
  id: string;
  contentSiteId: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// System entities
interface RefData {
  category: string;
  items: Array<{
    key: string;
    value: string;
    metadata?: any;
  }>;
}

const validClaims = [
  "Administrator",
  "PageCreator",
  "PageEditor",
  "PageDeleter",
  "PageMover",
  "SectionCreator",
  "SectionEditor",
  "SectionDeleter",
  "SectionMover",
  "ContentDesigner",
  "Publisher",
  "BusinessDeleter",
  "BusinessEditor",
  "BusinessCreator",
  "PublishApproval",
  "PublishDeleter",
  "Super",
  "StageCreator",
  "StageDeleter",
  "SiteMerger",
  "CatalogCreator",
  "CatalogEditor",
  "CatalogDeleter",
  "BusinessUserCreator",
  "BusinessUserEditor",
  //wrap
  "BusinessUserDeleter",
] as const;

// Create MCP server
const server = new McpServer({
  name: "headlesshost-tools-server",
  version: "1.0.0",
  capabilities: {
    tools: {},
    resources: {},
  },
});

// Helper function to handle API errors
function handleApiError(error: any): string {
  if (error.response) {
    return `API Error ${error.response.status}: ${error.response.data?.message || error.response.statusText}`;
  } else if (error.request) {
    return "Network Error: Unable to reach API server";
  } else {
    return `Error: ${error.message}`;
  }
}

// ========== GENERAL TOOLS ENDPOINTS ==========

// Ping - Test authentication and connection
server.registerTool(
  "ping",
  {
    title: "Ping API",
    description: "Test authentication and connection to the Headlesshost API",
    inputSchema: {},
  },
  async () => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.get("/tools/ping");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Health - Check API health status
server.registerTool(
  "health",
  {
    title: "Health Check",
    description: "Check the health status of the Headlesshost API",
    inputSchema: {},
  },
  async () => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.get("/tools/health");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Reference Data
server.registerTool(
  "get_ref_data",
  {
    title: "Get Reference Data",
    description: "Get system reference data and lookups for global use. For sections types call the get_staging_site_configuration endpoint.",
    inputSchema: {},
  },
  async () => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.get(`/tools/system/refdata`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ email, firstName, lastName, password, claims }) => {
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

      console.error("Create user payload:", JSON.stringify(payload, null, 2)); // Debug log

      const response: AxiosResponse<ApiResponse<User>> = await apiClient.post("/tools/membership/users", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ id }) => {
    try {
      const response: AxiosResponse<ApiResponse<User>> = await apiClient.get(`/tools/membership/users/${id}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Update User
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
        .union([
          z.enum(validClaims), // single claim
          z.array(z.enum(validClaims)), // multiple claims
        ])
        .optional()
        .describe(`User roles/claims (choose from: ${validClaims.join(", ")})`),
    },
  },
  async ({ id, email, firstName, lastName, claims }) => {
    try {
      const payload: any = {};
      if (email) payload.email = email;
      if (firstName) payload.firstName = firstName;
      if (lastName) payload.lastName = lastName;

      if (claims !== undefined && claims !== null) {
        // Normalize to array
        payload.claims = Array.isArray(claims) ? claims : [claims];
      }

      const response: AxiosResponse<ApiResponse<User>> = await apiClient.put(`/tools/membership/users/${id}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ id, reason }) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await apiClient.delete(`/tools/membership/users/${id}`, {
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
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ email, password, firstName, lastName, accountName }) => {
    try {
      const payload = { email, password, firstName, lastName, accountName };
      const response: AxiosResponse<ApiResponse<User>> = await apiClient.post("/tools/membership/register", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Account
server.registerTool(
  "get_account",
  {
    title: "Get Account",
    description: "Get current account information",
    inputSchema: {},
  },
  async () => {
    try {
      const response: AxiosResponse<ApiResponse<Account>> = await apiClient.get(`/tools/membership/account`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ name }) => {
    try {
      const payload: any = {};
      if (name) payload.name = name;

      const response: AxiosResponse<ApiResponse<Account>> = await apiClient.put("/tools/membership/account", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ userId, image }) => {
    try {
      const payload = { image };
      const response: AxiosResponse<ApiResponse> = await apiClient.post(`/tools/files/users/${userId}/profile-image`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, file, filename, mimetype }) => {
    try {
      // Convert base64 to buffer
      const buffer = Buffer.from(file, "base64");

      // Create FormData for multipart upload
      const formData = new FormData();

      // Add the file as a buffer with filename
      formData.append("file", buffer, {
        filename: filename || "uploaded-file.txt",
        contentType: mimetype || "application/octet-stream",
      });

      const response: AxiosResponse<ApiResponse> = await apiClient.post(`/tools/files/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/files`, formData, {
        headers: {
          ...formData.getHeaders(), // This sets Content-Type: multipart/form-data
        },
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
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, file, filename, mimetype }) => {
    try {
      // Convert base64 to buffer
      const buffer = Buffer.from(file, "base64");

      // Create FormData for multipart upload
      const formData = new FormData();

      // Add the file as a buffer with filename
      formData.append("file", buffer, {
        filename: filename || "uploaded-image.jpg",
        contentType: mimetype || "image/jpeg",
      });

      const response: AxiosResponse<ApiResponse> = await apiClient.post(`/tools/files/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/images`, formData, {
        headers: {
          ...formData.getHeaders(), // This sets Content-Type: multipart/form-data
        },
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
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ name, sampleDataId }) => {
    try {
      const payload = { name, sampleDataId };
      const response: AxiosResponse<ApiResponse> = await apiClient.post("/tools/content-sites", payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Content Sites
server.registerTool(
  "get_content_sites",
  {
    title: "Get Content Sites",
    description: "Get all content sites in the current account",
    inputSchema: {},
  },
  async ({}) => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.get(`/tools/content-sites`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Content Site
server.registerTool(
  "get_content_site",
  {
    title: "Get Content Site",
    description: "Get content site details by ID",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
    },
  },
  async ({ contentSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.get(`/tools/content-sites/${contentSiteId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Update Content Site
server.registerTool(
  "update_content_site",
  {
    title: "Update Staging Site",
    description: "Update staging site information",
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
  },
  async ({ contentSiteId, name, contactEmail, billingEmail, addressLine1, addressLine2, city, state, country, postalCode, productionUrl, repoUrl }) => {
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

      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, reason }) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await apiClient.delete(`/tools/content-sites/${contentSiteId}`, {
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
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, name, locale, isHead, content, stageUrl, guideUrl }) => {
    try {
      const payload: any = {};
      if (name) payload.name = name;
      if (locale) payload.locale = locale;
      if (isHead) payload.isHead = isHead;
      if (content) payload.content = content;
      if (stageUrl) payload.stageUrl = stageUrl;
      if (guideUrl) payload.guideUrl = guideUrl;

      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, reason }) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await apiClient.delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}`, {
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
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Publish Staging Site
server.registerTool(
  "publish_staging_site",
  {
    title: "Publish Staging Site",
    description: "Publish a staging site to make it live",
    inputSchema: {
      contentSiteId: z.string().describe("Content Site ID"),
      stagingSiteId: z.string().describe("Staging Site ID"),
      comments: z.string().describe("Message for this publish"),
      isApproved: z.boolean().describe("Is the publish approved"),
      publishAt: z.date().optional().describe("When to publish the staging site"),
      previewUrl: z.string().optional().describe("Preview URL for the staging site"),
    },
  },
  async ({ contentSiteId, stagingSiteId, comments, isApproved, publishAt, previewUrl }) => {
    try {
      const payload = { comments, isApproved, publishAt, previewUrl };
      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/publish`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Staging Site
server.registerTool(
  "get_staging_site",
  {
    title: "Get Staging Site",
    description: "Get staging site details by ID",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
  },
  async ({ contentSiteId, stagingSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<StagingSite>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<StagingSite>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Staging Site Configuration
server.registerTool(
  "get_staging_site_configuration",
  {
    title: "Get Staging Site Configuration",
    description: "Get staging site configuration by ID",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
    },
  },
  async ({ contentSiteId, stagingSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<StagingSite>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/configuration`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/logs`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId }) => {
    try {
      const params = new URLSearchParams();

      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/published-sites`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Revert Staging Site
server.registerTool(
  "revert_staging_site",
  {
    title: "Revert Staging Site",
    description: "Revert a staging site to a previous state",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      reason: z.string().optional().describe("Reason for reversion"),
    },
  },
  async ({ contentSiteId, stagingSiteId, reason }) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/revert`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Clone Staging Site
server.registerTool(
  "clone_staging_site",
  {
    title: "Clone Staging Site",
    description: "Clone a staging site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      newName: z.string().optional().describe("Name for the cloned site"),
    },
  },
  async ({ contentSiteId, stagingSiteId, newName }) => {
    try {
      const payload = { newName };
      const response: AxiosResponse<ApiResponse<StagingSite>> = await apiClient.post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/clone`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// ========== WORKING SITE SECTION MANAGEMENT TOOLS ==========

// Create Staging Site Section
server.registerTool(
  "create_staging_site_section",
  {
    title: "Create Staging Site Section",
    description: "Create a new section in a staging site page",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionType: z.string().describe("Section type"),
      content: z.record(z.any()).optional().describe("Section content which is a JSON object. The structure depends on the section type defined in the schema. The schema can be retrieved using the get_staging_site_configuration tool."),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionType, content }) => {
    try {
      const payload = { sectionType, content };
      const response: AxiosResponse<ApiResponse<any>> = await apiClient.post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Staging Site Section
server.registerTool(
  "get_staging_site_section",
  {
    title: "Get Staging Site Section",
    description: "Get details of a staging site section",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Update Staging Site Section
server.registerTool(
  "update_staging_site_section",
  {
    title: "Update Staging Site Section",
    description: "Update a staging site section",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
      content: z.record(z.any()).optional().describe("Section content which is a JSON object. The structure depends on the section type defined in the schema. The schema can be retrieved using the get_staging_site_configuration tool."),
      order: z.number().optional().describe("Section order"),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, content, order }) => {
    try {
      const payload: any = {};
      if (content) payload.content = content;
      if (order !== undefined) payload.order = order;

      const response: AxiosResponse<ApiResponse<any>> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }) => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId, publishMessage }) => {
    try {
      const payload = { publishMessage };
      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/publish`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Revert Staging Site Section
server.registerTool(
  "revert_staging_site_section",
  {
    title: "Revert Staging Site Section",
    description: "Revert a staging site section to a previous state",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section ID"),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }) => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/revert`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Staging Site Section Logs
server.registerTool(
  "get_staging_site_section_logs",
  {
    title: "Get Staging Site Section Logs",
    description: "Get logs for a staging site section since the last publish",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      sectionId: z.string().describe("Section Common ID (CID)"),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId, sectionId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/sections/${sectionId}/logs`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// ========== WORKING SITE PAGE MANAGEMENT TOOLS ==========

// Create Staging Site Page
server.registerTool(
  "create_staging_site_page",
  {
    title: "Create Staging Site Page",
    description: "Create a new page in a staging site",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      title: z.string().describe("Page title"),
      identifier: z.string().describe("Page identifier"),
      content: z.record(z.any()).optional().describe("Page content"),
    },
  },
  async ({ contentSiteId, stagingSiteId, title, identifier, content }) => {
    try {
      const payload = { title, identifier, content };
      const response: AxiosResponse<ApiResponse<any>> = await apiClient.post(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Revert Staging Site
server.registerTool(
  "revert_staging_site_page",
  {
    title: "Revert Staging Site",
    description: "Revert a staging site to a previous state",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      reason: z.string().optional().describe("Reason for reversion"),
    },
  },
  async ({ contentSiteId, stagingSiteId, reason, pageId }) => {
    try {
      const payload = { reason };
      const response: AxiosResponse<ApiResponse> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/revert`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Staging Site Page
server.registerTool(
  "get_staging_site_page",
  {
    title: "Get Staging Site Page",
    description: "Get details of a staging site page. Use the previewUrl from the get_staging_site response to view the page changes in real time.",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page ID"),
      includeSections: z.boolean().describe("Include page sections"),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId, includeSections }) => {
    try {
      const params = new URLSearchParams();
      if (includeSections) params.append("includeSections", "true");

      const response: AxiosResponse<ApiResponse<any>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}?${params}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, pageId, title, identifier, order }) => {
    try {
      const payload: any = {};
      if (title) payload.title = title;
      if (identifier) payload.identifier = identifier;
      if (order !== undefined) payload.order = order;

      const response: AxiosResponse<ApiResponse<any>> = await apiClient.put(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}`, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId, stagingSiteId, pageId }) => {
    try {
      const response: AxiosResponse<ApiResponse> = await apiClient.delete(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Get Staging Site Page Logs
server.registerTool(
  "get_staging_site_page_logs",
  {
    title: "Get Staging Site Page Logs",
    description: "Get the change logs for a staging site page since the last publish",
    inputSchema: {
      contentSiteId: z.string().describe("Content site ID"),
      stagingSiteId: z.string().describe("Staging site ID"),
      pageId: z.string().describe("Page common ID (CID)"),
    },
  },
  async ({ contentSiteId, stagingSiteId, pageId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/staging-sites/${stagingSiteId}/pages/${pageId}/logs`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/logs`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/hits`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<User[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/accounts`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  },
  async ({ contentSiteId }) => {
    try {
      const response: AxiosResponse<ApiResponse<any[]>> = await apiClient.get(`/tools/content-sites/${contentSiteId}/claims`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: handleApiError(error),
          },
        ],
        isError: true,
      };
    }
  }
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
  async () => {
    const config = {
      baseUrl: API_BASE_URL,
      hasApiKey: !!API_KEY,
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
  }
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
  async () => {
    try {
      const startTime = Date.now();
      const response = await apiClient.get("/tools/ping");
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
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with the JSON-RPC protocol on stdout
  console.error("Headlesshost MCP Server started successfully");
  console.error(`API Base URL: ${API_BASE_URL}`);
  console.error(`API Key configured: ${!!API_KEY}`);
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
