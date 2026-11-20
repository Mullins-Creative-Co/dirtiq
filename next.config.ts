import type { NextConfig } from "next";

const modelArtifacts = [
  "public/data/*.json", "public/data/cards/**/*.json", "public/data/odds/**/*.json",
  "public/data/results/**/*.json", "public/data/ml-predictions/**/*.json",
  "public/data/availability/latest.json", "public/sports/*.json",
  "data/ml-predictions/*.json", "public/data/dirtiq.seed.db",
];

const nextConfig: NextConfig = {
  output: "standalone",
  // The model artifacts are read with fs at request time through a runtime path, which the
  // tracer cannot follow; without this the serverless bundle ships without them.
  outputFileTracingIncludes: {
    "/*": modelArtifacts,
    "/**/*": modelArtifacts,
  },
  // Evaluation archives stay in git/CI; request handlers only need latest.json.
  outputFileTracingExcludes: {
    "/*": ["public/data/availability/history/**/*"],
    "/**/*": ["public/data/availability/history/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
