import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The model artifacts are read with fs at request time through a runtime path, which the
  // tracer cannot follow; without this the serverless bundle ships without them.
  outputFileTracingIncludes: {
    "/*": ["public/data/*.json"],
    "/**/*": ["public/data/*.json"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
