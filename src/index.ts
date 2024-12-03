import type { Context, Probot } from 'probot';
import type {
	DeploymentProtectionRuleRequestedEvent,
	PullRequestReviewSubmittedEvent,
} from '@octokit/webhooks-types';
import * as GitHubClient from './client.js';

export const instructionalComment =
	'One or more environments associated with this pull request require approval before deploying workflow runs.\n\n' +
	'Maintainers can approve by submitting a [Review](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request#submitting-your-review) with the comment `/deploy please`.';

export default (app: Probot) => {
	app.on('deployment_protection_rule.requested', async (context: Context) => {
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
				creator: {
					id: deployment?.creator.id,
					login: deployment?.creator.login,
				},
				ref: deployment?.ref,
				sha: deployment?.sha,
			},
		};

		app.log.info(
			'Received deployment protection rule event: %s',
			JSON.stringify(eventDetails, null, 2),
		);

		if (!deployment || !event || !environment || !callbackUrl) {
			app.log.error('Payload is missing required properties');
			return;
		}

		if (!['pull_request', 'pull_request_target', 'push'].includes(event)) {
			app.log.info(
				'Ignoring unsupported deployment protection rule event: %s',
				event,
			);
			return;
		}

		const bypassActors = process.env.BYPASS_ACTORS?.split(',') ?? [];
		if (bypassActors.includes(deployment.creator.id.toString())) {
			return context.octokit.request(`POST ${callbackUrl}`, {
				environment_name: environment,
				state: 'approved',
				comment: `Approved via bypass actors list for ${deployment.creator.login}`,
			});
		}

		app.log.debug(
			'Actor is not included in bypass actors: %s',
			deployment.creator.login,
		);

		const client = await app.auth(); // Gets an authenticated Octokit client
		const { data: appDetails } = await client.apps.getAuthenticated(); // Retrieves details about the authenticated app
		// app.log.info(JSON.stringify(appDetails, null, 2)); // Logs details about the app

		if (pullRequests) {
			for (const pull of pullRequests) {
				// get all reviews for the pull request
				const reviews = await GitHubClient.listPullRequestReviews(
					context,
					pull.number,
				);

				// find the first review that is not a changes requested review and has the same sha as the deployment
				const deployReview = reviews.find(
					(review) =>
						review.state !== 'CHANGES_REQUESTED' &&
						review.commit_id === deployment.sha &&
						review.body.startsWith('/deploy'),
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
					appDetails.id,
					instructionalComment,
				);

				// Try to avoid creating duplicate comments but there will always be a race condition
				if (comments.length === 0) {
					await GitHubClient.createIssueComment(
						context,
						pull.number,
						instructionalComment,
					);
				}
			}
		}
	});

	app.on('pull_request_review.submitted', async (context: Context) => {
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

		app.log.info(
			'Received pull request review event: %s',
			JSON.stringify(eventDetails, null, 2),
		);

		if (review.user.type === 'Bot') {
			app.log.info('Ignoring bot review');
			return;
		}

		if (!review.body?.startsWith('/deploy')) {
			app.log.info('Ignoring unsupported comment');
			return;
		}

		// const client = await app.auth(); // Gets an authenticated Octokit client
		// const { data: appDetails } = await client.apps.getAuthenticated(); // Retrieves details about the authenticated app
		// // app.log.info(JSON.stringify(appDetails, null, 2)); // Logs details about the app

		const runs = await GitHubClient.listWorkflowRuns(context, review.commit_id);

		for (const run of runs) {
			const deployments = await GitHubClient.listPendingDeployments(
				context,
				run.id,
			);

			if (deployments.length === 0) {
				app.log.info(
					'No pending deployments found for workflow run %s',
					run.id,
				);
				continue;
			}

			// map deployments to their environment names
			const environments = deployments
				.filter((deployment) => deployment.current_user_can_approve)
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
	});
	// For more information on building apps:
	// https://probot.github.io/docs/

	// To get your app running against GitHub, see:
	// https://probot.github.io/docs/development/
};

// Find existing comments that match the provided criteria
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
			c.performed_via_github_app.id === appId &&
			c.created_at === c.updated_at,
	);
}
