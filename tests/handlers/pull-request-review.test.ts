import nock from 'nock';
import { Probot, ProbotOctokit } from 'probot';
import fs from 'fs';
import path from 'path';
import { describe, beforeEach, afterEach, test, expect } from 'vitest';
import myProbotApp from '../../src/index.js';

const privateKey = fs.readFileSync(
	path.join(__dirname, '../fixtures/mock-cert.pem'),
	'utf-8',
);

// Test fixtures
interface WorkflowRun {
	id: number;
	actor: { id: number };
	head_sha: string;
	created_at: string;
}

interface Commit {
	author: { id: number; login: string } | null;
	committer: { id: number; login: string } | null;
	commit?: {
		verification: {
			verified: boolean;
			reason: string;
		} | null;
	};
}

interface PullRequestReview {
	action: string;
	review: {
		id: number;
		body: string;
		commit_id: string;
		submitted_at: string;
		state: string;
		user: {
			login: string;
			id: number;
		};
		html_url: string;
	};
	installation: { id: number };
	pull_request: {
		// eslint-disable-next-line id-denylist
		number: number;
		head: {
			ref: string;
		};
		base: {
			sha: string;
		};
	};
	repository: {
		owner: {
			login: string;
		};
		name: string;
	};
}

interface TestFixtures {
	pull_request_review: PullRequestReview;
	workflow_run: WorkflowRun;
	commit: Commit;
}

const reviewSubmittedAt = '2025-02-24T13:13:54Z';

const testFixtures: TestFixtures = {
	pull_request_review: {
		action: 'submitted',
		review: {
			id: 456,
			body: '/deploy please',
			commit_id: 'test-sha',
			// workflows must be created before this review was submitted
			submitted_at: reviewSubmittedAt,
			state: 'COMMENTED',
			user: {
				login: 'test-reviewer',
				id: 789,
			},
			html_url: 'https://github.com/test-org/test-repo/pull/123/reviews/456',
		},
		installation: { id: 12345678 },
		pull_request: {
			// eslint-disable-next-line id-denylist
			number: 123,
			head: {
				ref: 'test-branch',
			},
			base: {
				sha: 'base-sha',
			},
		},
		repository: {
			owner: {
				login: 'test-org',
			},
			name: 'test-repo',
		},
	},
	workflow_run: {
		id: 1234,
		actor: { id: 123 },
		head_sha: 'test-sha',
		created_at: new Date(
			new Date(reviewSubmittedAt).getTime() - 10 * 60 * 1000,
		).toISOString(),
	},
	commit: {
		author: { id: 123, login: 'test-user' },
		committer: { id: 123, login: 'test-user' },
		commit: {
			verification: {
				verified: true,
				reason: 'valid-signature',
			},
		},
	},
};

// Load the policy config fixtures
const basicApprovalFixture = fs.readFileSync(
	path.join(__dirname, '../fixtures/policy-configs/basic-approval-only.yml'),
	'utf-8',
);

const simpleReviewFixture = fs.readFileSync(
	path.join(__dirname, '../fixtures/policy-configs/simple-review-approval.yml'),
	'utf-8',
);

const deployCommentFixture = fs.readFileSync(
	path.join(
		__dirname,
		'../fixtures/policy-configs/deploy-comment-patterns.yml',
	),
	'utf-8',
);

const orgApprovalFixture = fs.readFileSync(
	path.join(__dirname, '../fixtures/policy-configs/org-approval-only.yml'),
	'utf-8',
);

describe('Pull Request Review Handler', () => {
	let probot: any;

	beforeEach(() => {
		nock.disableNetConnect();

		probot = new Probot({
			appId: 456,
			privateKey,
			Octokit: ProbotOctokit.defaults({
				retry: { enabled: false },
				throttle: { enabled: false },
			}),
		});
		probot.load(myProbotApp);
	});

	afterEach(() => {
		nock.cleanAll();
		nock.enableNetConnect();
	});

	test('skips workflows created within one minute of the review being submitted', async () => {
		// Use basic approval fixture for timing test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						...testFixtures.workflow_run,
						// 30 seconds before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								30 * 1000,
						).toISOString(),
					},
				],
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects pull request review if submitted_at property is unset', async () => {
		// Use basic approval fixture for timing validation test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		await probot.receive({
			name: 'pull_request_review',
			payload: {
				...testFixtures.pull_request_review,
				review: {
					...testFixtures.pull_request_review.review,
					submitted_at: undefined,
				},
			},
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('approves workflow when organization member review state is APPROVED', async () => {
		// Use org approval fixture for organization member test
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, orgApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, testFixtures.commit)
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{
					environment: { name: 'test' },
					current_user_can_approve: true,
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
			)
			.reply(200)
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/members')
			.times(2)
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'APPROVED',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('approves workflow when review state is APPROVED', async () => {
		// Use simple review fixture for APPROVED state test
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, simpleReviewFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, testFixtures.commit)
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{
					environment: { name: 'test' },
					current_user_can_approve: true,
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
			)
			.reply(200)
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.times(2)
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'APPROVED',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('approves workflow when review state is COMMENTED with deploy pattern', async () => {
		// Use deploy comment patterns fixture for COMMENTED with pattern test
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, deployCommentFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, testFixtures.commit)
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{
					environment: { name: 'test' },
					current_user_can_approve: true,
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
			)
			.reply(200)
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.times(2)
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'COMMENTED',
				body: '/deploy this PR',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects workflow when review state is CHANGES_REQUESTED', async () => {
		// Use basic approval fixture to test CHANGES_REQUESTED rejection
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'CHANGES_REQUESTED',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects workflow when review state is COMMENTED without deploy pattern', async () => {
		// Use deploy comment patterns fixture to test comment pattern matching failure
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, deployCommentFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'COMMENTED',
				body: 'Just a regular comment without deploy command',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects pull request review if author is also author of any commit', async () => {
		// Use basic approval fixture for author validation test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				user: {
					...testFixtures.pull_request_review.review.user,
					id: 123,
				},
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects pull request review if author is also committer of any commit', async () => {
		// Use basic approval fixture for committer validation test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				user: {
					...testFixtures.pull_request_review.review.user,
					id: 123,
				},
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects if there are no pending workflow runs after filtering', async () => {
		// Use basic approval fixture for workflow filtering test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						...testFixtures.workflow_run,
						head_sha: 'bad-sha',
					},
				],
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects if there are no pending deployments associated with the workflow run', async () => {
		// Use basic approval fixture for deployment validation test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [])
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects if current user cannot approve pending deployments', async () => {
		// Use basic approval fixture for approval permission test (needs comment patterns for COMMENTED reviews)
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{ environment: { name: 'test' }, current_user_can_approve: false },
			])
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles commit with undefined author', async () => {
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [
				{
					...testFixtures.commit,
					author: null,
				},
			])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			])
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, []);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles commit with undefined committer', async () => {
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [
				{
					...testFixtures.commit,
					committer: null,
				},
			])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			])
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, []);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles commit with undefined verification', async () => {
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [
				{
					...testFixtures.commit,
					commit: {
						...testFixtures.commit.commit,
						verification: null,
					},
				},
			])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			])
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, []);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles 422 error when deployment is already approved', async () => {
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, simpleReviewFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, testFixtures.commit)
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{
					environment: { name: 'test' },
					current_user_can_approve: true,
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
			)
			.reply(422, {
				message: 'There was a problem approving one of the gates',
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.times(2)
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'APPROVED',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('re-throws non-422 errors', async () => {
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, simpleReviewFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, testFixtures.commit)
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [testFixtures.workflow_run],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{
					environment: { name: 'test' },
					current_user_can_approve: true,
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
			)
			.reply(500, {
				message: 'Internal server error',
			})
			.get('/repos/test-org/test-repo/pulls/123/commits')
			.reply(200, [testFixtures.commit])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.times(2)
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				state: 'APPROVED',
			},
		};

		await expect(
			probot.receive({
				name: 'pull_request_review',
				payload,
			}),
		).rejects.toThrow();

		expect(mock.pendingMocks()).toStrictEqual([]);
	});
});
