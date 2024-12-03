import type { Probot } from 'probot';
import { handleDeploymentProtectionRule } from './handlers/deployment-protection-rule.js';
import { handlePullRequestReview } from './handlers/pull-request-review.js';

export { instructionalComment } from './handlers/deployment-protection-rule.js';

export default (app: Probot) => {
	app.on(
		'deployment_protection_rule.requested',
		handleDeploymentProtectionRule,
	);
	app.on('pull_request_review.submitted', handlePullRequestReview);
};
