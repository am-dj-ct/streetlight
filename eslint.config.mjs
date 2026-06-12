import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(debug|dir|error|info|log|table|trace|warn)$/] MemberExpression[object.name='req'][property.name='body']",
          message: "Do not log req.body.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(debug|dir|error|info|log|table|trace|warn)$/] Identifier[name=/^(body|details|draft|exportText|fileContents|goal|parsedBody|reply|reportBody|requestBody|messages)$/]",
          message: "Do not log request bodies or conversation messages.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(debug|dir|error|info|log|table|trace|warn)$/] Identifier[name=/^(request|response|completion|classifierResponse|finalMessage|stream)$/]",
          message: "Do not log raw request, response, stream, or completion objects.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(debug|dir|error|info|log|table|trace|warn)$/][arguments.length=1][arguments.0.type='Identifier'][arguments.0.name=/^(cause|err|error)$/]",
          message: "Do not pass raw error objects to console.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(debug|dir|error|info|log|table|trace|warn)$/] Property[key.name=/^(cause|err|error)$/][value.type='Identifier'][value.name=/^(cause|err|error)$/]",
          message: "Do not include raw error objects in console metadata.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored scratch tooling (audit/stress scripts); not shipped code.
    "tmp/**",
  ]),
]);

export default eslintConfig;
