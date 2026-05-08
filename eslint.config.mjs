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
            "CallExpression[callee.object.name='console'][callee.property.name=/^(log|warn|error)$/] MemberExpression[object.name='req'][property.name='body']",
          message: "Do not log req.body.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(log|warn|error)$/] Identifier[name='messages']",
          message: "Do not log conversation messages.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(log|warn|error)$/] Identifier[name=/^(request|response|completion)$/]",
          message: "Do not log raw request, response, or completion objects.",
        },
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name='error'][arguments.length=1][arguments.0.type='Identifier'][arguments.0.name='error']",
          message: "Do not pass raw error objects to console.error.",
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
  ]),
]);

export default eslintConfig;
