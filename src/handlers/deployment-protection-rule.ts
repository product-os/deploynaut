import type { Context } from 'probot';
import type { DeploymentProtectionRuleRequestedEvent } from '@octokit/webhooks-types';
import * as GitHubClient from '../client.js';

export const instructionalComment =
	'One or more environments require approval before deploying workflow runs.\n\n' +
	'Maintainers can approve by submitting a [Review](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request#submitting-your-review) of the current commit with `/deploy` in the body.\n\n' +
	'Please review changes carefully for improper handling of secrets or other sensitive information.';

export async function handleDeploymentProtectionRule(
	context: Context,
): Promise<any> {
	const {
		action,
		event,
		environment,
		deployment,
		deployment_callback_url: callbackUrl,
		pull_requests: pullRequests,
	} = context.payload as DeploymentProtectionRuleRequestedEvent;

	const eventDetails = {
		action,
		environment,
		event,
		deployment: {
			id: deployment?.id,
			ref: deployment?.ref,
			sha: deployment?.sha,
		},
	};

	context.log.info(
		'Received deployment protection rule event: %s',
		JSON.stringify(eventDetails),
	);

	if (!deployment || !event || !environment || !callbackUrl) {
		context.log.error('Payload is missing required properties');
		return;
	}

	if (!['pull_request', 'pull_request_target', 'push'].includes(event)) {
		context.log.info(
			'Ignoring unsupported deployment protection rule event: %s',
			event,
		);
		return;
	}

	// Get the commit that triggered the workflow run
	const commit = await GitHubClient.getCommit(context, deployment.sha);

	// Approve deployment if the commit author is in the bypass list
	const bypassActors = process.env.BYPASS_ACTORS?.split(',') ?? [];
	if (commit.author?.id && bypassActors.includes(commit.author.id.toString())) {
		return context.octokit.request(`POST ${callbackUrl}`, {
			environment_name: environment,
			state: 'approved',
			comment: `Approved via bypass actors list for ${commit.author.login}`,
		});
	}

	context.log.debug(
		'Commit author is not included in bypass actors: %s',
		commit.author?.login,
	);

	const client = await context.octokit.apps.getAuthenticated();

	if (pullRequests) {
		for (const pull of pullRequests) {
			const reviews = await GitHubClient.listPullRequestReviews(
				context,
				pull.number,
			);

			// Find an eligible review authored by a different user than the commit author or committer
			const deployReview = reviews.find(
				(review) =>
					['approved', 'commented'].includes(review.state.toLowerCase()) &&
					review.commit_id === deployment.sha &&
					review.user.id !== commit.author?.id &&
					review.user.id !== commit.committer?.id &&
					review.body?.startsWith('/deploy'),
			);

			if (deployReview) {
				return context.octokit.request(`POST ${callbackUrl}`, {
					environment_name: environment,
					state: 'approved',
					comment: `Approved by ${deployReview.user.login} via [review](${deployReview.html_url})`,
				});
			}

			const comments = await filterIssueComments(
				context,
				pull.number,
				client.data.id,
				instructionalComment,
			);

			if (comments.length === 0) {
				await GitHubClient.createIssueComment(
					context,
					pull.number,
					instructionalComment,
				);
			}
		}
	}
}

async function filterIssueComments(
	context: any,
	issueNumber: number,
	appId: number,
	startsWith: string,
): Promise<any> {
	const comments = await GitHubClient.listIssueComments(context, issueNumber);
	return comments.filter(
		(c) =>
			c.body.startsWith(startsWith) &&
			c.performed_via_github_app?.id === appId &&
			c.created_at === c.updated_at,
	);
}
