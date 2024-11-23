import type { Context, Probot } from 'probot';
import type {
	IssueCommentCreatedEvent,
	DeploymentProtectionRuleRequestedEvent,
} from '@octokit/webhooks-types';
import * as GitHubClient from './client.js';

export default (app: Probot) => {
	app.on('deployment_protection_rule.requested', async (context: Context) => {
		const {
			event,
			environment,
			deployment,
			deployment_callback_url: callbackUrl,
		} = context.payload as DeploymentProtectionRuleRequestedEvent;

		if (!deployment || !event || !environment || !callbackUrl) {
			context.log.error('Deployment protection rule not found');
			return;
		}

		console.log('Received event: deployment_protection_rule.requested');
		// console.log(JSON.stringify(context.payload, null, 2));
		// console.log(JSON.stringify(deployment, null, 2));

		if (!['pull_request', 'pull_request_target'].includes(event)) {
			context.log.info('Ignoring non-pull request event');
			return;
		}

		let appUser;
		try {
			appUser = await GitHubClient.whoAmI(context);
		} catch (error) {
			throw new Error('Failed to get app user: %s', error);
		}

		if (deployment.creator.id === appUser.id) {
			context.log.info('Ignoring self deployment');
			return;
		}

		const bypassActors = process.env.BYPASS_ACTORS?.split(',') ?? [];

		if (!bypassActors.includes(deployment.creator.id.toString())) {
			context.log.info(
				'User %s is not on the auto-approve list',
				deployment.creator.login,
			);
			return;
		}

		// const hasRepoWriteAccess = await GitHubClient.hasRepoWriteAccess(
		//   context,
		//   deployment.creator.login
		// );

		// if (!hasRepoWriteAccess) {
		//   context.log.info(
		//     "User %s does not have write access",
		//     deployment.creator.login
		//   );
		//   return;
		// }

		context.log.info('Approving deployment %s', deployment.id);
		return context.octokit.request(`POST ${callbackUrl}`, {
			environment_name: environment,
			state: 'approved',
			comment: `Auto-approved by ${appUser.login} on behalf of ${deployment.creator.login}`,
		});
	});

	app.on('issue_comment.created', async (context: Context) => {
		const { issue, comment } = context.payload as IssueCommentCreatedEvent;

		console.log('Received event: issue_comment.created');
		// console.log(JSON.stringify(context.payload, null, 2));

		if (issue.pull_request == null) {
			context.log.info('Ignoring non-pull request comment');
			return;
		}

		if (comment.user.type === 'Bot') {
			context.log.info('Ignoring bot comment');
			return;
		}

		if (!comment.body.startsWith('/deploy')) {
			context.log.info('Ignoring non-deploy comment');
			return;
		}

		if (comment.created_at !== comment.updated_at) {
			context.log.info('Ignoring edited comment');
			return;
		}

		// post a reaction to the comment with :eyes:
		await GitHubClient.addCommentReaction(context, comment.id, 'eyes');

		let appUser;
		try {
			appUser = await GitHubClient.whoAmI(context);
		} catch (error) {
			throw new Error('Failed to get app user: %s', error);
		}

		if (appUser.login === comment.user.login) {
			context.log.info('Ignoring self comment');
			return;
		}

		const hasRepoWriteAccess = await GitHubClient.hasRepoWriteAccess(
			context,
			comment.user.login,
		);

		if (!hasRepoWriteAccess) {
			context.log.info('User does not have write access');
			return;
		}

		const {
			head: { sha },
		} = await GitHubClient.getPullRequest(context, issue.number);

		// Get the ISO date 2-min before the comment.created_at
		const created = new Date(comment.created_at);
		created.setMinutes(created.getMinutes() - 2);

		// filter workflow runs with the given hash and a creation date 2 minutes or more before the comment created date
		// https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax#query-for-dates
		const runs = await GitHubClient.listWorkflowRuns(
			context,
			sha,
			`<${created.toISOString()}`,
		);

		if (runs.length === 0) {
			context.log.info('No workflow runs found for sha %s', sha);
			return;
		}

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

			for (const deployment of deployments) {
				if (!deployment.current_user_can_approve) {
					context.log.info(
						'User %s cannot approve deployment %s',
						appUser.login,
						deployment.id,
					);
					continue;
				}

				context.log.info(
					'Reviewing deployment with run %s and environment %s',
					run.id,
					deployment.environment.name,
				);
				await GitHubClient.reviewWorkflowRun(
					context,
					run.id,
					deployment.environment.name,
					'approved',
					`Approved by ${comment.user.login} via ${appUser.login}`,
				);
			}
		}
	});
	// For more information on building apps:
	// https://probot.github.io/docs/

	// To get your app running against GitHub, see:
	// https://probot.github.io/docs/development/
};
