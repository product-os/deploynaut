import type { Context } from 'probot';
import { PolicyEvaluator } from '../policy/evaluator.js';
import type { PolicyContext, PolicyConfig } from '../policy/types.js';
import {
	getCommit,
	listPullRequestReviews,
	listPullRequestCommits,
} from '../client.js';

export async function handleDeploymentProtectionRuleRequested(
	context: Context<'deployment_protection_rule.requested'>,
	config: PolicyConfig,
): Promise<void> {
	const {
		environment,
		deployment,
		pull_requests,
		deployment_callback_url: callbackUrl,
		event,
	} = context.payload;

	if (!environment || !deployment || !event) {
		context.log.error('Missing required payload data');
		return;
	}

	if (
		![
			'pull_request',
			'pull_request_target',
			'push',
			'workflow_dispatch',
		].includes(event)
	) {
		context.log.warn(
			'Ignoring unsupported deployment protection rule event: %s',
			event,
		);
		return;
	}

	// Get the commit info
	const commit = await getCommit(context, deployment.sha);

	// First try with just environment and commit context
	const initialContext: PolicyContext = {
		environment: {
			name: environment,
		},
		deployment: {
			ref: deployment.ref,
			environment: environment,
			event: context.payload.event,
			commit: {
				sha: deployment.sha,
			},
		},
		commits: [
			{
				sha: deployment.sha,
				author: commit.author
					? {
							id: commit.author.id,
							login: commit.author.login,
						}
					: undefined,
				committer: commit.committer
					? {
							id: commit.committer.id,
							login: commit.committer.login,
						}
					: undefined,
				verification: commit.commit.verification
					? {
							verified: commit.commit.verification.verified,
							reason: commit.commit.verification.reason,
						}
					: undefined,
			},
		],
		reviews: [],
	};

	// Evaluate the policy with initial context
	const evaluator = new PolicyEvaluator(config, context, context.log);
	let isApproved = await evaluator.evaluate(initialContext);

	if (isApproved) {
		context.log.info(`Deployment ${deployment.id} approved by policy`);
		try {
			await context.octokit.request(`POST ${callbackUrl}`, {
				environment_name: environment,
				state: 'approved',
				comment: `Approved by policy`,
			});
		} catch (error: any) {
			if (error.status === 422) {
				context.log.warn(
					'Deployment already approved, skipping duplicate approval',
				);
				return;
			}
			throw error;
		}
		return; // early return if the deployment is approved by the commit author or committer rules
	}

	// If not approved and we have pull requests, check each PR's reviews
	if (pull_requests) {
		for (const pr of pull_requests) {
			// Get all reviews for this PR
			const reviews = await listPullRequestReviews(context, pr.number);

			// Get all commits for this PR
			const commits = await listPullRequestCommits(context, pr.number);

			// Create context with PR review information
			const prContext: PolicyContext = {
				...initialContext,
				reviews: reviews
					.filter((review) => review.user !== null)
					.map((review) => ({
						id: review.id,
						user: {
							id: review.user.id,
							login: review.user.login,
						},
						state: review.state,
						body: review.body ?? undefined,
						commit_id: review.commit_id ?? undefined,
						html_url: review.html_url ?? undefined,
						submitted_at: review.submitted_at ?? '',
					})),
				commits: commits.map((prCommit) => ({
					sha: prCommit.sha,
					author: prCommit.author
						? {
								id: prCommit.author.id,
								login: prCommit.author.login,
							}
						: undefined,
				})),
			};

			// re-evaluate policy with each PR context
			isApproved = await evaluator.evaluate(prContext);

			// Respond to the deployment protection rule request with the first approved PR.
			// It's okay to break the for loop here because we are approving the entire deployment,
			// not just the individual pull requests.
			if (isApproved) {
				context.log.info(`Deployment ${deployment.id} approved by policy`);
				try {
					await context.octokit.request(`POST ${callbackUrl}`, {
						environment_name: environment,
						state: 'approved',
						comment: `Approved by policy`,
					});
				} catch (error: any) {
					if (error.status === 422) {
						context.log.warn(
							'Deployment already approved, skipping duplicate approval',
						);
						return;
					}
					throw error;
				}
				return; // early return if the deployment is approved by the PR reviews rules
			}
		}
	}
}
