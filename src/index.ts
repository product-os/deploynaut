import type { Context, Probot } from 'probot';
import type {
	DeploymentProtectionRuleRequestedEvent,
	PullRequestReviewSubmittedEvent,
} from '@octokit/webhooks-types';
import * as GitHubClient from './client.js';

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

		context.log.info(
			'Received deployment protection rule event: %s',
			JSON.stringify(eventDetails, null, 2),
		);

		if (!deployment || !event || !environment || !callbackUrl) {
			context.log.error('Payload is missing required properties');
			return;
		}

		// app.log.info('Received Deployment Protection Rule with Deployment ID: %s', deployment.id);
		// app.log.info(JSON.stringify(context.payload, null, 2));

		// const client = await app.auth(); // Gets an authenticated Octokit client
		// const { data: appDetails } = await client.apps.getAuthenticated(); // Retrieves details about the authenticated app
		// // app.log.info(JSON.stringify(appDetails, null, 2)); // Logs details about the app

		if (!['pull_request', 'pull_request_target', 'push'].includes(event)) {
			context.log.info(
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

		context.log.debug(
			'Actor is not included in bypass actors: %s',
			deployment.creator.login,
		);

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

		context.log.info(
			'Received pull request review event: %s',
			JSON.stringify(eventDetails, null, 2),
		);

		if (review.user.type === 'Bot') {
			context.log.info('Ignoring bot review');
			return;
		}

		if (!review.body?.startsWith('/deploy')) {
			context.log.info('Ignoring unsupported comment');
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
				context.log.info(
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
