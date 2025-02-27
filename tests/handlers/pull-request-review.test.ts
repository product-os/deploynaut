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
const testFixtures = {
	pull_request_review: {
		action: 'submitted',
		review: {
			id: 456,
			body: '/deploy please',
			commit_id: 'test-sha',
			// workflows must be created before this review was submitted
			submitted_at: '2025-02-24T13:13:54Z',
			state: 'COMMENTED',
			user: {
				login: 'test-user',
				id: 789,
			},
			html_url: 'https://github.com/test-org/test-repo/pull/123/reviews/456',
		},
		installation: { id: 12345678 },
		pull_request: {
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
};

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

	test('validates pull request workflows with matching commit', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						id: 1234,
						actor: { id: 123 },
						head_sha: 'test-sha',
						// ~10 minutes before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								10 * 60 * 1000,
						).toISOString(),
					},
				],
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
			.reply(200);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('validates pull request target workflows with matching branch', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						id: 1234,
						actor: { id: 123 },
						event: 'pull_request_target',
						// ~10 minutes before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								10 * 60 * 1000,
						).toISOString(),
					},
				],
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
			.reply(200);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('skips workflows created within one minute of the review being submitted', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						id: 1234,
						actor: { id: 123 },
						head_sha: 'test-sha',
						// 30 seconds before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								30 * 1000,
						).toISOString(),
					},
				],
			});

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('skips all workflows if submitted_at is not included in the review', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						id: 1234,
						actor: { id: 123 },
						head_sha: 'test-sha',
						// ~10 minutes before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								10 * 60 * 1000,
						).toISOString(),
					},
				],
			});

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

	test('ignores unsupported review states', async () => {
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
	});

	test('ignores unsupported comments', async () => {
		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				body: 'Just a regular comment',
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(nock.pendingMocks()).toStrictEqual([]);
	});

	test('ignores reviews by Bots', async () => {
		const payload = {
			...testFixtures.pull_request_review,
			review: {
				...testFixtures.pull_request_review.review,
				user: {
					...testFixtures.pull_request_review.review.user,
					type: 'Bot',
				},
			},
		};

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(nock.pendingMocks()).toStrictEqual([]);
	});

	test('ignores review by commit author', async () => {
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

		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 456 } });

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('ignores review by commit committer', async () => {
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

		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 456 }, committer: { id: 123 } });

		await probot.receive({
			name: 'pull_request_review',
			payload,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('exits early if no matching workflow runs', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [{ id: 1234, actor: { id: 123 }, head_sha: 'bad-sha' }],
			});

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('exits early if no pending deployments', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						id: 1234,
						actor: { id: 123 },
						head_sha: 'test-sha',
						// ~10 minutes before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								10 * 60 * 1000,
						).toISOString(),
					},
				],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, []);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('exits early if no deployments can be approved', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, { author: { id: 123 }, committer: { id: 123 } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, {
				workflow_runs: [
					{
						id: 1234,
						actor: { id: 123 },
						head_sha: 'test-sha',
						// ~10 minutes before the review was submitted
						created_at: new Date(
							new Date(
								testFixtures.pull_request_review.review.submitted_at,
							).getTime() -
								10 * 60 * 1000,
						).toISOString(),
					},
				],
			})
			.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
			.reply(200, [
				{ environment: { name: 'test' }, current_user_can_approve: false },
			]);

		await probot.receive({
			name: 'pull_request_review',
			payload: testFixtures.pull_request_review,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});
});
