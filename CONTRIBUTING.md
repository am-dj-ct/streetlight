# Contributing

Thanks for your interest in Access Tool.

This project is currently maintained by one person. Contributions are welcome,
but review and merge bandwidth is intentionally limited during launch.

## Before You Open an Issue

1. Check existing issues and docs first.
2. Use clear reproduction steps.
3. Do not paste user conversation content.
4. Prefer synthetic examples.

For sensitive vulnerabilities, use [SECURITY.md](SECURITY.md) instead of a
public issue.

## Local Setup

```bash
npm install
npm run dev:mock
```

Before opening a pull request, run:

```bash
npm run verify:quick
```

If your change touches model behavior, safety, data, or copy contracts, run the
relevant deeper checks from `README.md`.

## Pull Request Guidelines

1. Keep changes scoped and explain why.
2. Follow existing architectural constraints in:
   - `docs/data_architecture.md`
   - `docs/access_tool_v1_spec.md`
   - `docs/forbidden.md`
3. Do not introduce analytics, content logging, or user data retention.
4. Include test/verification evidence in the PR description.

## Contribution License

By submitting a contribution, you agree that your contribution is licensed
under this repository's Apache-2.0 license.
