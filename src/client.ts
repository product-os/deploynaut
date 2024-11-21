export async function whoAmI(context: any): Promise<any> {
	const query = `query { viewer { databaseId login } }`;
	const { viewer } = await context.octokit.graphql(query);
	console.log(`Authenticated as: ${viewer.login}`);
	return { login: viewer.login, id: viewer.databaseId };
}

// https://octokit.github.io/rest.js/v21/#repos-get-collaborator-permission-level
// https://docs.github.com/en/rest/collaborators/collaborators#list-repository-collaborators
export async function hasRepoWriteAccess(
	context: any,
	username: string,
): Promise<boolean> {
	const request = context.repo({
		username,
	});

	const {
		data: { permission },
	} = await context.octokit.rest.repos.getCollaboratorPermissionLevel(request);

	context.log.info(
		`Permission level for ${username}: ${JSON.stringify(permission, null, 2)}`,
	);

	return ['admin', 'write'].includes(permission);
}

export async function addCommentReaction(
	context: any,
	commentId: number,
	content: string,
): Promise<void> {
	const request = context.repo({
		comment_id: commentId,
		content,
	});

	await context.octokit.reactions.createForIssueComment(request);
}

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

export async function listPullRequestContributors(
	context: any,
	prNumber: number,
): Promise<string[]> {
	const commits = await this.listPullRequestCommits(context, prNumber);
	return commits.map((c: any) => c.author.id);
}

export async function listPullRequestCommits(
	context: any,
	prNumber: number,
): Promise<any[]> {
	const request = context.repo({
		pull_number: prNumber,
	});
	const { data: commits } =
		await context.octokit.rest.pulls.listPullRequestCommits(request);
	return commits;
}

export async function getPullRequest(
	context: any,
	prNumber: number,
): Promise<any> {
	const request = context.repo({
		pull_number: prNumber,
	});
	const { data: pullRequest } = await context.octokit.rest.pulls.get(request);
	return pullRequest;
}

// https://octokit.github.io/rest.js/v21/#actions-list-workflow-runs-for-repo
// https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository
// https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax#query-for-dates
export async function listWorkflowRuns(
	context: any,
	headSha: string,
	created: string,
): Promise<any> {
	// what is the status "requested" used for?
	const request = context.repo({
		status: 'waiting',
		created,
		head_sha: headSha,
	});

	context.log.info(
		`Searching for workflow runs with ${JSON.stringify(request, null, 2)}`,
	);
	const {
		data: { workflow_runs: runs },
	} = await context.octokit.rest.actions.listWorkflowRunsForRepo(request);
	// console.log(JSON.stringify(runs, null, 2))
	return runs;
}

// https://octokit.github.io/rest.js/v21/#actions-get-pending-deployments-for-run
// https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#get-pending-deployments-for-a-workflow-run
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
