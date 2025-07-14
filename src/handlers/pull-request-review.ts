import type { Context } from 'probot';
import { PolicyEvaluator } from '../policy/evaluator.js';
import type { PolicyContext, PolicyConfig } from '../policy/types.js';
import {
	listPullRequestCommits,
	listPendingDeployments,
	listWorkflowRuns,
	reviewWorkflowRun,
	getCommit,
} from '../client.js';
import type { WorkflowRun } from '@octokit/webhooks-types';

export async function handlePullRequestReviewSubmitted(
	context: Context<'pull_request_review.submitted'>,
	config: PolicyConfig,
) {
	const { review, pull_request } = context.payload;

	// // Get all commits for this PR
	const commits = await listPullRequestCommits(context, pull_request.number);
	// // const commits = [(await getCommit(context, pull_request.head.sha))];

	// Gather all the context data we need
	const approvalContext: PolicyContext = {
		commits: commits.map((commit) => ({
			sha: commit.sha,
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
		})),
		reviews: [
			{
				id: review.id,
				user: {
					id: review.user.id,
					login: review.user.login,
				},
				state: review.state,
				body: review.body ?? undefined,
				submitted_at: review.submitted_at ?? undefined,
				commit_id: review.commit_id,
			},
		],
	};

	const evaluator = new PolicyEvaluator(config, context, context.log);

	if (!(await evaluator.evaluate(approvalContext))) {
		context.log.warn('Pull request review not approved');
		return;
	}

	// Find all "waiting" workflow runs associated with this pull request branch.
	const workflowRuns = await listWorkflowRuns(context, pull_request.head.ref);

	// Exclude workflows that were created within one minute of the review being submitted.
	// This is to prevent time-of-check to time-of-use (TOCTOU) attacks.
	// Only include workflows that were created by the reviewed commit or a
	// pull request target workflow where the commit is from the target branch anyway.
	const filteredWorkflowRuns = workflowRuns.filter((workflowRun) => {
		// If submitted_at time is not provided, use 0 so no workflows can be approved
		const submittedAt = review.submitted_at ? new Date(review.submitted_at) : 0;
		const createdAt = new Date(workflowRun.created_at);
		const isWithinTimeWindow =
			new Date(createdAt.getTime() + 60 * 1000) < submittedAt;
		const isValidSha =
			workflowRun.head_sha === review.commit_id ||
			workflowRun.event === 'pull_request_target';

		if (isValidSha && !isWithinTimeWindow) {
			context.log.warn(
				'Workflow run %s filtered: created too close to review submission (created: %s, review: %s)',
				workflowRun.id,
				createdAt.toISOString(),
				submittedAt instanceof Date ? submittedAt.toISOString() : 'invalid',
			);
		}

		return isValidSha && isWithinTimeWindow;
	});

	await Promise.all(
		filteredWorkflowRuns.map(async (workflowRun: WorkflowRun) => {
			const pendingDeployments = await listPendingDeployments(
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
				environmentNames.map(async (environmentName) => {
					const commit = await getCommit(context, workflowRun.head_sha);

					const isApproved = await evaluator.evaluate({
						...approvalContext,
						deployment: {
							ref: workflowRun.head_branch,
							environment: environmentName,
							event: workflowRun.event,
							commit: {
								sha: commit.sha,
								// author: commit.author
								// 	? {
								// 			id: commit.author.id,
								// 			login: commit.author.login,
								// 		}
								// 	: undefined,
								// committer: commit.committer
								// 	? {
								// 			id: commit.committer.id,
								// 			login: commit.committer.login,
								// 		}
								// 	: undefined,
							},
						},
						// commits: [
						// 	{
						// 		sha: commit.sha,
						// 		author: commit.author
						// 			? {
						// 					id: commit.author.id,
						// 					login: commit.author.login,
						// 				}
						// 			: undefined,
						// 		committer: commit.committer
						// 			? {
						// 					id: commit.committer.id,
						// 					login: commit.committer.login,
						// 				}
						// 			: undefined,
						// 	},
						// ],
					});
					if (isApproved) {
						context.log.info(
							`Workflow run ${workflowRun.id} approved by policy`,
						);
						try {
							await reviewWorkflowRun(
								context,
								workflowRun.id,
								environmentName,
								'approved',
								`Approved by policy`,
							);
						} catch (error: any) {
							if (error.status === 422) {
								context.log.warn(
									'Deployment already approved, skipping duplicate approval',
								);
								return;
							}
							throw error;
						}
					}
				}),
			);
		}),
	);
}
