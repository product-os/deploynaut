import type {
	WorkflowRun,
	PullRequestReview,
	IssueComment,
} from '@octokit/webhooks-types';
import type { components } from '@octokit/openapi-types';
type PendingDeployment = components['schemas']['pending-deployment'];
type Commit = components['schemas']['commit'];

// // https://octokit.github.io/rest.js/v21/#repos-get-collaborator-permission-level
// // https://docs.github.com/en/rest/collaborators/collaborators#list-repository-collaborators
// export async function hasRepoWriteAccess(
// 	context: any,
// 	username: string,
// ): Promise<boolean> {
// 	const request = context.repo({
// 		username,
// 	});

// 	const {
// 		data: { permission },
// 	} = await context.octokit.rest.repos.getCollaboratorPermissionLevel(request);

// 	context.log.info(
// 		`Permission level for ${username}: ${JSON.stringify(permission, null, 2)}`,
// 	);

// 	return ['admin', 'write'].includes(permission);
// }

// // https://octokit.github.io/rest.js/v21/#reactions-create-for-issue-comment
// // https://docs.github.com/en/rest/reactions/reactions#create-reaction-for-an-issue-comment
// export async function addCommentReaction(
// 	context: any,
// 	commentId: number,
// 	content: string,
// ): Promise<void> {
// 	const request = context.repo({
// 		comment_id: commentId,
// 		content,
// 	});

// 	await context.octokit.reactions.createForIssueComment(request);
// }

// // https://octokit.github.io/rest.js/v21/#reactions-create-for-pull-request-review-comment
// // https://docs.github.com/en/rest/reactions/reactions#create-reaction-for-a-pull-request-review-comment
// export async function addPullRequestReviewCommentReaction(
// 	context: any,
// 	commentId: number,
// 	content: string,
// ): Promise<void> {
// 	const request = context.repo({
// 		comment_id: commentId,
// 		content,
// 	});

// 	await context.octokit.reactions.createForPullRequestReviewComment(request);
// }

// // https://octokit.github.io/rest.js/v21/#repos-list-deployments
// // https://docs.github.com/en/rest/deployments/deployments#list-deployments
// export async function listDeployments(
//   context: any,
//   sha: string
// ): Promise<Deployment[]> {
//   const request = context.repo({
//     sha,
//   });
//   const { data: deployments } =
//     await context.octokit.rest.repos.listDeployments(request);
//   return deployments;
// }

// // https://octokit.github.io/rest.js/v21/#pulls-list-commits
// // https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request
// export async function listPullRequestCommits(
// 	context: any,
// 	prNumber: number,
// ): Promise<any[]> {
// 	const request = context.repo({
// 		pull_number: prNumber,
// 	});
// 	const { data: commits } =
// 		await context.octokit.rest.pulls.listCommits(request);
// 	return commits;
// }

// https://octokit.github.io/rest.js/v21/#repos-get-commit
// https://docs.github.com/en/rest/commits/commits#get-a-commit
export async function getCommit(context: any, ref: string): Promise<Commit> {
	const request = context.repo({
		ref,
	});
	const { data: commit } = await context.octokit.rest.repos.getCommit(request);
	return commit;
}

// https://octokit.github.io/rest.js/v21/#pulls-list-reviews
// https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request
export async function listPullRequestReviews(
	context: any,
	prNumber: number,
): Promise<PullRequestReview[]> {
	const request = context.repo({
		pull_number: prNumber,
	});
	const { data: reviews } =
		await context.octokit.rest.pulls.listReviews(request);
	return reviews;
}

// https://octokit.github.io/rest.js/v21/#actions-list-workflow-runs-for-repo
// https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository
export async function listWorkflowRuns(
	context: any,
	headSha: string,
): Promise<WorkflowRun[]> {
	// what is the status "requested" used for?
	const request = context.repo({
		status: 'waiting',
		head_sha: headSha,
	});
	const {
		data: { workflow_runs: runs },
	} = await context.octokit.rest.actions.listWorkflowRunsForRepo(request);
	return runs;
}

// https://octokit.github.io/rest.js/v21/#actions-get-pending-deployments-for-run
// https://docs.github.com/en/rest/actions/workflow-runs#get-pending-deployments-for-a-workflow-run
export async function listPendingDeployments(
	context: any,
	runId: number,
): Promise<PendingDeployment[]> {
	const request = context.repo({
		run_id: runId,
	});
	const { data: deployments } =
		await context.octokit.rest.actions.getPendingDeploymentsForRun(request);
	// console.log(JSON.stringify(deployments, null, 2))
	return deployments;
}

// // https://docs.github.com/en/rest/deployments/deployments#get-a-deployment
// // https://octokit.github.io/rest.js/v21/#repos-get-deployment
// export async function getDeployment(
// 	context: any,
// 	deploymentId: number,
// ): Promise<Deployment> {
// 	const request = context.repo({
// 		deployment_id: deploymentId,
// 	});
// 	const { data: deployment } =
// 		await context.octokit.rest.repos.getDeployment(request);
// 	return deployment;
// }

// https://octokit.github.io/rest.js/v21/#actions-review-custom-gates-for-run
// https://docs.github.com/en/rest/actions/workflow-runs#review-custom-deployment-protection-rules-for-a-workflow-run
export async function reviewWorkflowRun(
	context: any,
	runId: number,
	environment: string,
	state: string,
	comment: string,
): Promise<void> {
	const request = context.repo({
		run_id: runId,
		environment_name: environment,
		state,
		comment,
	});

	await context.octokit.rest.actions.reviewCustomGatesForRun(request);
}

// https://octokit.github.io/rest.js/v18/#issues-list-comments
// https://docs.github.com/en/rest/issues/comments#list-issue-comments
export async function listIssueComments(
	context: any,
	issueNumber: number,
): Promise<IssueComment[]> {
	const request = context.repo({
		issue_number: issueNumber,
	});
	const { data: comments } =
		await context.octokit.rest.issues.listComments(request);
	return comments;
}

// https://octokit.github.io/rest.js/v18/#issues-create-comment
// https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
export async function createIssueComment(
	context: any,
	issueNumber: number,
	body: string,
): Promise<IssueComment> {
	const request = context.repo({
		issue_number: issueNumber,
		body,
	});
	const { data: comment } =
		await context.octokit.rest.issues.createComment(request);
	return comment;
}

// // https://octokit.github.io/rest.js/v18/#issues-delete-comment
// // https://docs.github.com/en/rest/issues/comments#delete-an-issue-comment
// export async function deleteIssueComment(
// 	context: any,
// 	commentId: number,
// ): Promise<void> {
// 	const request = context.repo({
// 		comment_id: commentId,
// 	});
// 	await context.octokit.rest.issues.deleteComment(request);
// }
