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
            "CallExpression[callee.object.name='console'][callee.property.name=/^(debug|dir|error|info|log|table|trace|warn)$/] Identifier[name=/^(body|details|draft|exportText|fileContents|goal|parsedBody|reply|reportBody|requestBody|messages|attachment|attachments|pendingAttachments|image|images|photo|photos|file|files|pickedFile|dataUrl|dataBase64|blob|upload|uploads|bytes|buffer|bitmap|canvas)$/]",
          message: "Do not log request bodies, conversation messages, or attachment data.",
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
    // scripts/check-build-runtime-parity.mjs builds a second, separately
    // rooted Next output here (next.config.ts reads NEXT_DIST_DIR) so the
    // parity proof's dev server doesn't rewrite the production build's
    // .next underneath itself. It is gitignored but not covered by the
    // .next/** ignore above, so once a local or reused-workspace run has
    // produced it, every later `npm run lint` fails on generated chunks
    // instead of real source -- caught by running lint twice in the same
    // worktree after a parity run.
    ".next-parity-dev/**",
    // Gitignored scratch tooling (audit/stress scripts); not shipped code.
    "tmp/**",
  ]),
]);

export default eslintConfig;
