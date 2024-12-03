import nock from 'nock';
import myProbotApp, { instructionalComment } from '../src/index.js';
import { Probot, ProbotOctokit } from 'probot';
import fs from 'fs';
import path from 'path';
import { describe, beforeEach, afterEach, test, expect } from 'vitest';

const privateKey = fs.readFileSync(
	path.join(__dirname, 'fixtures/mock-cert.pem'),
	'utf-8',
);

// Test fixtures
const testFixtures = {
	deployment_protection_rule: {
		action: 'requested',
		environment: 'test',
		event: 'pull_request',
		deployment_callback_url:
			'https://api.github.com/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
		deployment: {
			creator: {
				login: 'bypass-actor',
				id: 5,
			},
			sha: 'test-sha',
		},
		installation: { id: 12345678 },
		repository: {
			owner: {
				login: 'test-org',
			},
			name: 'test-repo',
		},
		// eslint-disable-next-line id-denylist
		pull_requests: [{ number: 123 }],
	},
	pull_request_review: {
		action: 'submitted',
		review: {
			id: 456,
			body: '/deploy please',
			commit_id: 'test-sha',
			user: {
				login: 'test-user',
				id: 789,
			},
		},
		installation: { id: 12345678 },
		repository: {
			owner: {
				login: 'test-org',
			},
			name: 'test-repo',
		},
	},
};

describe('GitHub Deployment App', () => {
	let probot: any;

	beforeEach(() => {
		nock.disableNetConnect();
		process.env.BYPASS_ACTORS = '5,10';
		probot = new Probot({
			appId: 456,
			privateKey,
			// Disable request throttling and retries for testing
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

	describe('deployment_protection_rule.requested', () => {
		test('approves deployment created by bypass user', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post(
					'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
				)
				.reply(200);

			await probot.receive({
				name: 'deployment_protection_rule',
				payload: testFixtures.deployment_protection_rule,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('skips events with missing properties', async () => {
			const payload = {
				...testFixtures.deployment_protection_rule,
				event: null,
			};

			const result = await probot.receive({
				name: 'deployment_protection_rule',
				payload: payload,
			});

			expect(result).toBeUndefined();
			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('skips unsupported events', async () => {
			const payload = {
				...testFixtures.deployment_protection_rule,
				event: 'workflow_run',
			};

			const result = await probot.receive({
				name: 'deployment_protection_rule',
				payload: payload,
			});

			expect(result).toBeUndefined();
			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		// test('ignores deployment from unauthorized user', async () => {
		// 	const mock = nock('https://api.github.com')
		// 		.post('/app/installations/12345678/access_tokens')
		// 		.reply(200, { token: 'test', permissions: { issues: 'write' } })
		// 		.get('/app')
		// 		.reply(200, { id: 456 })
		// 		.get('/repos/test-org/test-repo/pulls/123/reviews')
		// 		.reply(200, [{ commit_id: 'test-sha', body: '/deploy please' }]);
		// 	const payload = {
		// 		...testFixtures.deployment_protection_rule,
		// 		deployment: {
		// 			creator: {
		// 				login: 'unauthorized-user',
		// 				id: 789,
		// 			},
		// 		},
		// 	};

		// 	await probot.receive({
		// 		name: 'deployment_protection_rule',
		// 		payload,
		// 	});

		// 	expect(mock.pendingMocks()).toStrictEqual([]);
		// });

		// test('handles undefined BYPASS_ACTORS', async () => {
		// 	process.env.BYPASS_ACTORS = '';

		// 	const mock = nock('https://api.github.com')
		// 		.post('/app/installations/12345678/access_tokens')
		// 		.reply(200, { token: 'test', permissions: { issues: 'write' } })
		// 		.get('/repos/test-org/test-repo/pulls/123/reviews')
		// 		.reply(200, []);

		// 	await probot.receive({
		// 		name: 'deployment_protection_rule',
		// 		payload: testFixtures.deployment_protection_rule,
		// 	});

		// 	expect(mock.pendingMocks()).toStrictEqual([]);
		// });

		// test('handles defined bypass actors with multiple values', async () => {
		// 	process.env.BYPASS_ACTORS = '5,10,15';

		// 	const mock = nock('https://api.github.com')
		// 		.post('/app/installations/12345678/access_tokens')
		// 		.reply(200, { token: 'test', permissions: { issues: 'write' } })
		// 		.get('/repos/test-org/test-repo/pulls/123/reviews')
		// 		.reply(200, []);

		// 	await probot.receive({
		// 		name: 'deployment_protection_rule',
		// 		payload: testFixtures.deployment_protection_rule,
		// 	});

		// 	expect(mock.pendingMocks()).toStrictEqual([]);
		// });

		test('approves deployment for APPROVED pull request review', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.get('/app')
				.reply(200, { id: 456 })
				.get('/repos/test-org/test-repo/pulls/123/reviews')
				.reply(200, [
					{
						commit_id: 'test-sha',
						body: '/deploy please',
						state: 'APPROVED',
						user: { login: 'test-user', id: 789 },
					},
				])
				.post(
					'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
				)
				.reply(200);

			process.env.BYPASS_ACTORS = '';

			await probot.receive({
				name: 'deployment_protection_rule',
				payload: testFixtures.deployment_protection_rule,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('approves deployment for COMMENTED pull request review', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.get('/app')
				.reply(200, { id: 456 })
				.get('/repos/test-org/test-repo/pulls/123/reviews')
				.reply(200, [
					{
						commit_id: 'test-sha',
						body: '/deploy please',
						state: 'commented',
						user: { login: 'test-user', id: 789 },
					},
				])
				.post(
					'/repos/test-org/test-repo/actions/runs/1234/deployment_protection_rule',
				)
				.reply(200);

			process.env.BYPASS_ACTORS = '';

			await probot.receive({
				name: 'deployment_protection_rule',
				payload: testFixtures.deployment_protection_rule,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('creates instructional comment for CHANGES_REQUESTED pull request review', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.get('/app')
				.reply(200, { id: 456 })
				.get('/repos/test-org/test-repo/pulls/123/reviews')
				.reply(200, [
					{
						commit_id: 'test-sha',
						body: '/deploy please',
						state: 'CHANGES_REQUESTED',
						user: { login: 'test-user', id: 789 },
					},
				])
				.get('/repos/test-org/test-repo/issues/123/comments')
				.reply(200, [])
				.post('/repos/test-org/test-repo/issues/123/comments', {
					body: instructionalComment,
				})
				.reply(200);

			process.env.BYPASS_ACTORS = '';

			await probot.receive({
				name: 'deployment_protection_rule',
				payload: testFixtures.deployment_protection_rule,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('avoids creating duplicate comments', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.get('/app')
				.reply(200, { id: 456 })
				.get('/repos/test-org/test-repo/pulls/123/reviews')
				.reply(200, [])
				.get('/repos/test-org/test-repo/issues/123/comments')
				.reply(200, [
					{
						id: 123,
						body: instructionalComment,
						performed_via_github_app: { id: 456 },
					},
				]);

			process.env.BYPASS_ACTORS = '';

			await probot.receive({
				name: 'deployment_protection_rule',
				payload: testFixtures.deployment_protection_rule,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});
	});

	describe('pull_request_review.submitted', () => {
		test('processes valid deploy comment', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.get('/repos/test-org/test-repo/actions/runs')
				.query(true)
				.reply(200, { workflow_runs: [{ id: 1234 }] })
				.get('/repos/test-org/test-repo/actions/runs/1234/pending_deployments')
				.reply(200, [
					{ environment: { name: 'test' }, current_user_can_approve: true },
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

		test('ignores non-deploy comments', async () => {
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

		test('ignores bot comments', async () => {
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

		test('exits early if no matching workflow runs', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.get('/repos/test-org/test-repo/actions/runs')
				.query(true)
				.reply(200, { workflow_runs: [] });

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
				.get('/repos/test-org/test-repo/actions/runs')
				.query(true)
				.reply(200, { workflow_runs: [{ id: 1234 }] })
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
				.get('/repos/test-org/test-repo/actions/runs')
				.query(true)
				.reply(200, { workflow_runs: [{ id: 1234 }] })
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
});
