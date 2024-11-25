import type { Context, Probot } from 'probot';
import type {
	DeploymentProtectionRuleRequestedEvent,
	PullRequestReviewSubmittedEvent,
} from '@octokit/webhooks-types';
import * as GitHubClient from './client.js';

export default (app: Probot) => {
	app.on('deployment_protection_rule.requested', async (context: Context) => {
		const {
			event,
			environment,
			deployment,
			deployment_callback_url: callbackUrl,
			pull_requests: pullRequests,
		} = context.payload as DeploymentProtectionRuleRequestedEvent;

		if (
			!deployment ||
			!event ||
			!environment ||
			!callbackUrl ||
			!pullRequests
		) {
			context.log.error('Deployment protection rule not found');
			return;
		}

		app.log.info('Received event: deployment_protection_rule.requested');
		// app.log.info(JSON.stringify(context.payload, null, 2));

		if (!['pull_request', 'pull_request_target'].includes(event)) {
			context.log.info('Ignoring non-pull request event');
			return;
		}

		// const client = await app.auth(); // Gets an authenticated Octokit client
		// const { data: appDetails } = await client.apps.getAuthenticated(); // Retrieves details about the authenticated app
		// // app.log.info(JSON.stringify(appDetails, null, 2)); // Logs details about the app

		const bypassActors = process.env.BYPASS_ACTORS?.split(',') ?? [];
		if (bypassActors.includes(deployment.creator.id.toString())) {
			// context.log.info('Approving deployment %s', deployment.id);
			return context.octokit.request(`POST ${callbackUrl}`, {
				environment_name: environment,
				state: 'approved',
				comment: `Approved via bypass actors list for ${deployment.creator.login}`,
			});
		}

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
					comment: `Approved by ${deployReview.user.login} via review [comment](${deployReview.html_url})`,
				});
			}
		}
	});

	app.on('pull_request_review.submitted', async (context: Context) => {
		const {
			review,
			pull_request: {
				head: { sha },
			},
		} = context.payload as PullRequestReviewSubmittedEvent;

		app.log.info('Received event: pull_request_review.submitted');
		// app.log.info(JSON.stringify(context.payload, null, 2));

		if (review.user.type === 'Bot') {
			context.log.info('Ignoring bot review');
			return;
		}

		if (!review.body?.startsWith('/deploy')) {
			context.log.info('Ignoring non-deploy comment');
			return;
		}

		// const client = await app.auth(); // Gets an authenticated Octokit client
		// const { data: appDetails } = await client.apps.getAuthenticated(); // Retrieves details about the authenticated app
		// // app.log.info(JSON.stringify(appDetails, null, 2)); // Logs details about the app

		// let approved = false;

		const runs = await GitHubClient.listWorkflowRuns(context, sha);

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
				context.log.info(
					'Reviewing deployment with run %s and environment %s',
					run.id,
					environment,
				);
				await GitHubClient.reviewWorkflowRun(
					context,
					run.id,
					environment,
					'approved',
					`Approved by ${review.user.login} via review [comment](${review.html_url})`,
				);
				// approved = true;
			}
		}

		// if (approved) {
		// 	// post a reaction to the comment with :rocket:
		// 	await GitHubClient.addPullRequestReviewCommentReaction(
		// 		context,
		// 		review.id,
		// 		'rocket',
		// 	);
		// } else {
		// 	// post a reaction to the comment with :confused:
		// 	await GitHubClient.addPullRequestReviewCommentReaction(
		// 		context,
		// 		review.id,
		// 		'confused',
		// 	);
		// }
	});
	// For more information on building apps:
	// https://probot.github.io/docs/

	// To get your app running against GitHub, see:
	// https://probot.github.io/docs/development/
};
