import type { Probot } from 'probot';
import type { Context } from 'probot';
import type {
	DeploymentProtectionRuleRequestedEvent,
	PullRequestReviewSubmittedEvent,
} from '@octokit/webhooks-types';
import { handleDeploymentProtectionRuleRequested } from './handlers/deployment-protection.js';
import { handlePullRequestReviewSubmitted } from './handlers/pull-request-review.js';
import type { PolicyConfig } from './policy/types.js';

const DEFAULT_CONFIG: PolicyConfig = {
	policy: {
		approval: [],
	},
	approval_rules: [],
};

async function getAppConfig(context: Context) {
	const config = await context.config('deploynaut.yml', DEFAULT_CONFIG);

	if (!config) {
		context.log.error('No configuration found');
		return null;
	}

	context.log.debug(`Configuration loaded: ${JSON.stringify(config)}`);

	// If no approval rules are configured, do not allow deployment
	const approvalRules = config?.policy?.approval;
	if (!approvalRules || approvalRules.length === 0) {
		context.log.warn('No approval rules found');
		return null;
	}

	return config;
}

export default (app: Probot) => {
	app.on('deployment_protection_rule.requested', async (context: Context) => {
		const payload = context.payload as DeploymentProtectionRuleRequestedEvent;
		if (payload.action === 'requested') {
			const config = await getAppConfig(context);
			if (!config) {
				return;
			}

			await handleDeploymentProtectionRuleRequested(
				context as Context<'deployment_protection_rule.requested'>,
				config,
			);
		}
	});

	app.on('pull_request_review.submitted', async (context: Context) => {
		const payload = context.payload as PullRequestReviewSubmittedEvent;
		if (payload.action === 'submitted') {
			const config = await getAppConfig(context);
			if (!config) {
				return;
			}

			await handlePullRequestReviewSubmitted(
				context as Context<'pull_request_review.submitted'>,
				config,
			);
		}
	});
};
