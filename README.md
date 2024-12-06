# deploynaut

A GitHub App built with [Probot](https://github.com/probot/probot) to approve deployments via reviews from maintainers

## How It Works

### Overview

Deploynaut functions as a GitHub App, managing deployment approvals via [custom deployment protection rules](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/creating-custom-deployment-protection-rules).

### Approval Process

Deployments are approved by submitting a review with the `/deploy` command.

#### Deployment Validation

- Validates deployment source and context when triggered on a protected environment.
- Auto-approves or requests manual approval based on event type.

#### Automatic Approval Conditions

Deployments are auto-approved if:

- They triggered by a previously approved commit SHA (including pull request merges).
- They are initiated by an allowlisted user (e.g., Renovate) who is:
  - The author of the commit that triggered the deployment.
  - Listed in the `BYPASS_USERS` IDs.

#### Manual Approval Process

For manual approvals:

- An eligible reviewer submits a [review](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request#submitting-your-review) with the `/deploy` command.
- The app approves pending deployments matching the reviewed commit SHA.

#### Eligible Reviewers

Reviewers must:

- Have repository write access or higher.
- Not be the commit author or committer.
- Not be a bot account.

### Security Measures

Key security features include:

- Using commit SHA as the review source of truth.
- Ensuring comment integrity (unmodified since creation).
- Maintaining stateless operations.
- Preventing TOCTOU attacks with atomic operations.
- Requiring different actors for commit and approval.

### Example Workflow

1. Developer opens a PR and triggers a deployment.
2. App receives a deployment protection rule event.
3. If not auto-approved, the app comments on the PR with instructions.
4. Eligible reviewer submits a review with `/deploy`.
5. App validates the approval and enables deployment.

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t deploynaut .

# 2. Start container
docker run --env-file .env deploynaut
```

## Environment Variables

Probot configuration variables are documented [here](https://probot.github.io/docs/configuration/).

> [!NOTE]
> When deploying to production and using a custom domain (not smee), the Callback URL in the GitHub App needs to include TLD + WEBHOOK_PATH.
>
> e.g. `https://my-custom-domain.com/api/github/webhooks`

Additional environment variables specific to this app:

- `BYPASS_ACTORS`: A comma-separated list of GitHub user IDs to bypass the approval process.

  For users, you can find the ID by visiting `https://api.github.com/users/<username>`
  For apps, you can find the ID by visiting `https://api.github.com/users/<app-name>%5Bbot%5D`

## Contributing

If you have suggestions for how deploynaut could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

This project is licensed under Apache 2.0 - see the [LICENSE](LICENSE) file for
details.
