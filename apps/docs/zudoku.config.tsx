import type { ZudokuConfig } from "zudoku";

const config: ZudokuConfig = {
  site: {
    title: "Mesh Docs",
    logo: {
      src: { light: "/logo-light.svg", dark: "/logo-dark.svg" },
      alt: "Mesh",
      width: "120px",
    },
  },
  metadata: {
    title: "Mesh Docs",
    description:
      "Self-hostable MCP policy gateway — setup guides and Admin API reference generated from OpenAPI.",
  },
  navigation: [
    {
      type: "category",
      label: "Guides",
      items: [
        "/introduction",
        "/authentication",
        "/self-hosting",
      ],
    },
    {
      type: "link",
      to: "/api",
      label: "API Reference",
    },
  ],
  redirects: [{ from: "/", to: "/introduction" }],
  apis: [
    {
      type: "file",
      input: "./apis/openapi.json",
      path: "/api",
    },
  ],
  docs: {
    files: "/pages/**/*.{md,mdx}",
  },
  defaults: {
    apis: {
      examplesLanguage: "shell",
      schemaDownload: {
        enabled: true,
        fileName: "mesh-openapi",
      },
    },
  },
};

export default config;
