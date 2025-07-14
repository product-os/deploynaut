# deploynaut

A GitHub App built with [Probot](https://github.com/probot/probot) that manages deployment approvals via custom deployment protection rules. It enables secure, policy-driven deployment approvals through GitHub PR reviews and comments.

## Architecture

### Event-Driven Processing

Deploynaut processes two main GitHub webhook events:

1. **`deployment_protection_rule.requested`** - Triggered when a deployment requires approval
2. **`pull_request_review.submitted`** - Triggered when a PR review is submitted

Both events are processed by a **Policy Evaluator** that reads configuration from YAML policy files.

### Policy Configuration

The app uses YAML configuration files that define approval rules and requirements. Configuration is loaded using Probot's configuration framework, supporting both organization-level and repository-level policies:

- **Organization-level**: `.github/deploynaut.yml` in the organization's `.github` repository
- **Repository-level**: `.github/deploynaut.yml` in the specific repository

### Core Components

1. **Policy Evaluator**: Evaluates deployment requests against configured approval rules
2. **Event Handlers**: Process incoming webhook events and coordinate with the evaluator
3. **GitHub API Client**: Handles GitHub API interactions for user permissions and commit data

### How It Works

#### Deployment Protection Flow

1. **Trigger**: GitHub deployment triggers `deployment_protection_rule.requested` event
2. **Policy Loading**: App loads YAML configuration from `.github/deploynaut.yml`
3. **Context Gathering**: Collects commit data, user memberships, and review information
4. **Policy Evaluation**: Evaluates approval rules against the deployment context
5. **Decision**: Auto-approves or requests manual approval based on policy outcome

#### Review Processing Flow

1. **Trigger**: PR review submission triggers `pull_request_review.submitted` event
2. **Validation**: Validates review eligibility and comment patterns
3. **Policy Check**: Evaluates if the review satisfies approval requirements
4. **Approval**: Approves matching pending deployments for the commit SHA

#### Security Model

- **Commit SHA Verification**: Uses commit SHA as source of truth for approvals
- **Actor Separation**: Prevents self-approval (different commit author and reviewer required)
- **Comment Integrity**: Validates comments haven't been modified since creation
- **Stateless Operations**: No persistent state between requests to prevent TOCTOU attacks

## Configuration

### Policy File Structure

Create a `.github/deploynaut.yml` file in your organization's `.github` repository or in individual repositories:

```yaml
# High-level policy definition
policy:
  approval:
    - or:
        - auto-approve-main
        - team-has-approved
        - has-valid-signatures
        - authored-by-bot

# Approval rule definitions
approval_rules:
  - name: auto-approve-main
    if:
      ref_patterns:
        - main
        - master
        - release/*
    requires:
      count: 0

  - name: team-has-approved
    requires:
      count: 1
      teams: ['org/team-name']
    methods:
      github_review: true
      github_review_comment_patterns: ['^/deploy']

  - name: has-valid-signatures
    if:
      has_valid_signatures_by:
        teams: ['org/team-name']
        users: ['trusted-user']
        organizations: ['org-name']
    requires:
      count: 0

  - name: authored-by-bot
    if:
      authored_by:
        users: ['renovate[bot]']
    requires:
      count: 0
```

### Approval Rules

Each approval rule supports:

#### Conditions (`if`)

- **`ref_patterns`**: Match deployment ref (branch/tag) against regex patterns
- **`has_valid_signatures_by`**: Commits signed by authorized users/teams/orgs
- **`only_has_contributors_in`**: Commits authored and committed by authorized users or team members
- **`environment`**: Environment-specific conditions

#### Requirements (`requires`)

- **`count`**: Number of approvals needed
- **`users`**: Specific users who can approve
- **`teams`**: Teams whose members can approve (format: `org/team-name`)
- **`organizations`**: Organizations whose members can approve

#### Methods (`methods`)

- **`github_review`**: Accept GitHub PR reviews
- **`github_review_comment_patterns`**: Accept comments matching regex patterns

### Configuration Hierarchy

1. **Repository-level**: `.github/deploynaut.yml` in the repository
2. **Organization-level**: `.github/deploynaut.yml` in the organization's `.github` repository
3. **Fallback**: If no configuration found, all deployments require manual approval

### Policy Schema

The policy configuration schema is based on a subset of the configuration used by [policy-bot](https://github.com/palantir/policy-bot) due to the large overlap in functionality. While policy-bot approves pull requests, deploynaut approves deployments using similar approval rules and conditions.

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

## Deployment

### GitHub App Installation

1. **Create GitHub App**: Use the provided `app.yml` manifest to create a GitHub App via [GitHub's App manifest flow](https://docs.github.com/en/developers/apps/building-github-apps/creating-a-github-app-from-a-manifest)

2. **Required Permissions**:
   - `actions: read` - Access workflow information
   - `contents: read` - Repository contents and commits
   - `deployments: write` - Manage deployment statuses
   - `metadata: read` - Repository metadata access
   - `pull_requests: write` - Comment on and modify PRs
   - `members: read` - Organization members and teams

3. **Webhook Events**:
   - `deployment_protection_rule` - Deployment approval requests
   - `pull_request_review` - PR review submissions

4. **Installation**: Install the GitHub App on your organization or specific repositories

### Environment Configuration

Probot configuration variables are documented in the [Probot configuration guide](https://probot.github.io/docs/configuration/).

> [!NOTE]
> When deploying to production with a custom domain, set the Callback URL to include your domain + webhook path:
> `https://your-domain.com/api/github/webhooks`

## Planned

- **Event Conditions**: Allow conditional rules based on the event type that triggered the deployment
- **Policy Status Page**: Publish a deployment policy status page via PR checks

## Contributing

If you have suggestions for how deploynaut could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

This project is licensed under Apache 2.0 - see the [LICENSE](LICENSE) file for
details.
