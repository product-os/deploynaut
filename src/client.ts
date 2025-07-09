import type {
	WorkflowRun,
	PullRequestReview,
	User,
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

// https://octokit.github.io/rest.js/v21/#pulls-list-commits
// https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request
export async function listPullRequestCommits(
	context: any,
	prNumber: number,
): Promise<Commit[]> {
	const request = context.repo({
		pull_number: prNumber,
	});
	const { data: commits } =
		await context.octokit.rest.pulls.listCommits(request);
	return commits;
}

// https://octokit.github.io/rest.js/v21/#repos-get-commit
// https://docs.github.com/en/rest/commits/commits#get-a-commit
export async function getCommit(context: any, ref: string): Promise<Commit> {
	const request = context.repo({
		ref,
	});
	const { data: commit } = await context.octokit.rest.repos.getCommit(request);
	return commit;
}

// // https://docs.github.com/en/rest/commits/commits#get-a-commit
// export function isCommitVerified(commit: Commit): boolean {
// 	return (
// 		commit.commit.verification?.verified === true &&
// 		commit.commit.verification?.reason === 'valid'
// 	);
// }

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
	branch: string,
	status = 'waiting',
): Promise<WorkflowRun[]> {
	const request = context.repo({
		status,
		branch,
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

// // https://octokit.github.io/rest.js/v18/#issues-list-comments
// // https://docs.github.com/en/rest/issues/comments#list-issue-comments
// export async function listIssueComments(
// 	context: any,
// 	issueNumber: number,
// ): Promise<IssueComment[]> {
// 	const request = context.repo({
// 		issue_number: issueNumber,
// 	});
// 	const { data: comments } =
// 		await context.octokit.rest.issues.listComments(request);
// 	return comments;
// }

// // https://octokit.github.io/rest.js/v18/#issues-create-comment
// // https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
// export async function createIssueComment(
// 	context: any,
// 	issueNumber: number,
// 	body: string,
// ): Promise<IssueComment> {
// 	const request = context.repo({
// 		issue_number: issueNumber,
// 		body,
// 	});
// 	const { data: comment } =
// 		await context.octokit.rest.issues.createComment(request);
// 	return comment;
// }

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

// // https://octokit.github.io/rest.js/v18/#orgs-list-for-user
// // https://docs.github.com/en/rest/orgs/orgs#list-organizations-for-a-user
// // https://octokit.github.io/rest.js/v18/#teams-list-for-authenticated-user
// // https://docs.github.com/en/rest/teams/teams#list-teams-for-the-authenticated-user
// export async function getUserMemberships(context: any, username: string) {
// 	const orgs = await context.octokit.orgs.listForUser({ username });
// 	const teams = await context.octokit.teams.listForAuthenticatedUser({
// 		username,
// 	});
// 	return {
// 		organizations: orgs.data.map((org: { login: string }) => ({
// 			login: org.login,
// 		})),
// 		teams: teams.data.map(
// 			(team: { slug: string; organization: { login: string } }) => ({
// 				slug: team.slug,
// 				organization: team.organization.login,
// 			}),
// 		),
// 	};
// }

// // https://octokit.github.io/rest.js/v18/#repos-create-deployment-status
// // https://docs.github.com/en/rest/deployments/statuses#create-a-deployment-status
// export async function createDeploymentStatus(
// 	context: any,
// 	deploymentId: number,
// 	state: 'success' | 'failure',
// 	environment: string,
// 	description: string,
// ): Promise<void> {
// 	const request = context.repo({
// 		deployment_id: deploymentId,
// 		state,
// 		environment,
// 		description,
// 	});
// 	await context.octokit.rest.repos.createDeploymentStatus(request);
// }

// https://octokit.github.io/rest.js/v21/#orgs-list-members
// https://docs.github.com/en/rest/orgs/members#list-organization-members
export async function listOrganizationMembers(
	context: any,
	org: string,
): Promise<User[]> {
	const { data: members } = await context.octokit.rest.orgs.listMembers({
		org,
	});
	return members;
}

// https://octokit.github.io/rest.js/v21/#teams-list-members-in-org
// https://docs.github.com/en/rest/teams/members#list-team-members
export async function listTeamMembers(
	context: any,
	org: string,
	team: string,
): Promise<User[]> {
	const { data: members } = await context.octokit.rest.teams.listMembersInOrg({
		org,
		team_slug: team,
	});
	return members;
}
