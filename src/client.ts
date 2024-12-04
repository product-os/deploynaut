// export async function whoAmI(context: any): Promise<any> {
// 	const query = `query { viewer { databaseId login } }`;
// 	const { viewer } = await context.octokit.graphql(query);
// 	console.log(`Authenticated as: ${viewer.login} (${viewer.databaseId})`);
// 	return { login: viewer.login, id: viewer.databaseId };
// }

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

// https://docs.github.com/en/rest/deployments/deployments#list-deployments
// export async function listDeployments(
//   context: any,
//   sha: string
// ): Promise<any[]> {
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

// https://octokit.github.io/rest.js/v21/#pulls-list-reviews
// https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request
export async function listPullRequestReviews(
	context: any,
	prNumber: number,
): Promise<any[]> {
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
): Promise<any> {
	// what is the status "requested" used for?
	const request = context.repo({
		status: 'waiting',
		head_sha: headSha,
	});
	const {
		data: { workflow_runs: runs },
	} = await context.octokit.rest.actions.listWorkflowRunsForRepo(request);
	// console.log(JSON.stringify(runs, null, 2))
	return runs;
}

// https://octokit.github.io/rest.js/v21/#actions-get-pending-deployments-for-run
// https://docs.github.com/en/rest/actions/workflow-runs#get-pending-deployments-for-a-workflow-run
export async function listPendingDeployments(
	context: any,
	runId: number,
): Promise<any[]> {
	const request = context.repo({
		run_id: runId,
	});
	const { data: deployments } =
		await context.octokit.rest.actions.getPendingDeploymentsForRun(request);
	// console.log(JSON.stringify(deployments, null, 2))
	return deployments;
}

// https://octokit.github.io/rest.js/v21/#actions-review-custom-gates-for-run
// https://docs.github.com/en/rest/actions/workflow-runs#review-custom-deployment-protection-rules-for-a-workflow-run
export async function reviewWorkflowRun(
	context: any,
	runId: number,
	environment: string,
	state: string,
	comment: string,
): Promise<any> {
	const request = context.repo({
		run_id: runId,
		environment_name: environment,
		state,
		comment,
	});

	const { data: review } =
		await context.octokit.rest.actions.reviewCustomGatesForRun(request);
	return review;
}

// https://octokit.github.io/rest.js/v18/#issues-list-comments
// https://docs.github.com/en/rest/issues/comments#list-issue-comments
export async function listIssueComments(
	context: any,
	issueNumber: number,
): Promise<any[]> {
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
): Promise<any> {
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
