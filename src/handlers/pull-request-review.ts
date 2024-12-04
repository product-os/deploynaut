import type { Context } from 'probot';
import type { PullRequestReviewSubmittedEvent } from '@octokit/webhooks-types';
import * as GitHubClient from '../client.js';

export async function handlePullRequestReview(context: Context) {
	const { review } = context.payload as PullRequestReviewSubmittedEvent;

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
	};

	context.log.info(
		'Received pull request review event: %s',
		JSON.stringify(eventDetails, null, 2),
	);

	if (!review.body?.startsWith('/deploy')) {
		context.log.debug('Ignoring unsupported comment');
		return;
	}

	if (review.user.type === 'Bot') {
		context.log.debug('Ignoring review by Bot: %s', review.user.login);
		return;
	}

	const runs = await GitHubClient.listWorkflowRuns(context, review.commit_id);

	for (const run of runs) {
		const deployments = await GitHubClient.listPendingDeployments(
			context,
			run.id,
		);

		if (deployments.length === 0) {
			context.log.info(
				'No pending deployments found for workflow run %s',
				run.id,
			);
			continue;
		}

		const environments = deployments
			.filter((deployment) => deployment.current_user_can_approve)
			.filter((deployment) => deployment.creator.id !== review.user.id)
			.map((deployment) => deployment.environment.name);

		for (const environment of environments) {
			await GitHubClient.reviewWorkflowRun(
				context,
				run.id,
				environment,
				'approved',
				`Approved by ${review.user.login} via [review](${review.html_url})`,
			);
		}
	}
}
