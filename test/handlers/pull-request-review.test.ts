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
			state: 'COMMENTED',
			user: {
				login: 'test-user',
				id: 789,
			},
			html_url: 'https://github.com/test-org/test-repo/pull/123/reviews/456',
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

	test('processes valid deploy comment', async () => {
		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, { workflow_runs: [{ id: 1234, actor: { id: 123 } }] })
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

	test('ignores review by workflow run actor', async () => {
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
			.get('/repos/test-org/test-repo/actions/runs')
			.query(true)
			.reply(200, { workflow_runs: [{ id: 1234, actor: { id: 123 } }] });

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
			.reply(200, { workflow_runs: [{ id: 1234, actor: { id: 123 } }] })
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
			.reply(200, { workflow_runs: [{ id: 1234, actor: { id: 123 } }] })
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
