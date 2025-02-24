import type { Context } from 'probot';
import type {
	PullRequestReviewSubmittedEvent,
	WorkflowRun,
} from '@octokit/webhooks-types';
import * as GitHubClient from '../client.js';
import assert from 'assert';

export async function handlePullRequestReview(context: Context) {
	const { review, pull_request } =
		context.payload as PullRequestReviewSubmittedEvent;

	const eventDetails = {
		review: {
			id: review.id,
			body: review.body,
			commit_id: review.commit_id,
			user: {
				id: review.user.id,
				login: review.user.login,
			},
		},
		pull_request: {
			head: {
				ref: pull_request.head.ref,
			},
		},
	};

	context.log.info(
		'Received pull request review event: %s',
		JSON.stringify(eventDetails),
	);

	if (!['approved', 'commented'].includes(review.state.toLowerCase())) {
		context.log.debug('Ignoring unsupported review state: %s', review.state);
		return;
	}

	// Comment reviews need to start with /deploy
	// Approved reviews do not need to match any string
	if (
		review.state.toLowerCase() === 'commented' &&
		!review.body?.startsWith('/deploy')
	) {
		context.log.debug('Ignoring unsupported comment');
		return;
	}

	if (review.user.type === 'Bot') {
		context.log.debug('Ignoring review by Bot: %s', review.user.login);
		return;
	}

	// Get the commit of the submitted review
	const commit = await GitHubClient.getCommit(context, review.commit_id);

	assert(commit.author, `Failed to get author for SHA: ${review.commit_id}`);
	assert(
		commit.committer,
		`Failed to get committer for SHA: ${review.commit_id}`,
	);

	if (commit.author.id === review.user.id) {
		context.log.debug(
			'Ignoring review by author of the commit: %s',
			review.user.login,
		);
		return;
	}

	if (commit.committer.id === review.user.id) {
		context.log.debug(
			'Ignoring review by committer of the commit: %s',
			review.user.login,
		);
		return;
	}

	// Find all "waiting" workflow runs associated with this pull request branch.
	const workflowRuns = await GitHubClient.listWorkflowRuns(
		context,
		pull_request.head.ref,
	);

	// Filter workflows to only include commits that were reviewed directly,
	// or from pull request target workflows which do not use the same branch SHA.
	const filteredWorkflowRuns = workflowRuns.filter((workflowRun) => {
		return (
			workflowRun.head_sha === review.commit_id ||
			workflowRun.event === 'pull_request_target'
		);
	});

	await Promise.all(
		filteredWorkflowRuns.map(async (workflowRun: WorkflowRun) => {
			const pendingDeployments = await GitHubClient.listPendingDeployments(
				context,
				workflowRun.id,
			);

			context.log.info(
				'Pending deployments for workflow run %s: %s',
				workflowRun.id,
				JSON.stringify(pendingDeployments),
			);

			const environmentNames = pendingDeployments
				.filter((deployment) => deployment.current_user_can_approve)
				.filter((deployment) => deployment.environment.name !== undefined)
				.map((deployment) => deployment.environment.name!);

			await Promise.all(
				environmentNames.map((environmentName) =>
					GitHubClient.reviewWorkflowRun(
						context,
						workflowRun.id,
						environmentName,
						'approved',
						`Approved by ${review.user.login} via [review](${review.html_url})`,
					),
				),
			);
		}),
	);
}
