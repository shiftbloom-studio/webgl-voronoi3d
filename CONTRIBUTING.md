# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

```sh
nvm use        # Node 26
npm ci
npm run check  # typecheck, tests, build, package lint
```

## Pull requests

- Keep a pull request to one change, with a test where it makes sense.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for titles (`feat:`, `fix:`, `docs:`, `chore:`).
- If the published package changes, add a changeset: `npx changeset`. Maintainers release by merging the "chore: version packages" pull request.

By contributing you agree that your contribution is licensed under AGPL-3.0-or-later, the license of this project.

Please follow the [code of conduct](CODE_OF_CONDUCT.md).
