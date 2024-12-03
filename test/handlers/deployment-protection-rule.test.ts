import nock from 'nock';
import { Probot, ProbotOctokit } from 'probot';
import fs from 'fs';
import path from 'path';
import { describe, beforeEach, afterEach, test, expect } from 'vitest';
import myProbotApp from '../../src/index.js';
import { instructionalComment } from '../../src/handlers/deployment-protection-rule.js';

const privateKey = fs.readFileSync(
	path.join(__dirname, '../fixtures/mock-cert.pem'),
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
};

describe('Deployment Protection Rule Handler', () => {
	let probot: any;

	beforeEach(() => {
		nock.disableNetConnect();
		process.env.BYPASS_ACTORS = '5';
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

	test('handles undefined BYPASS_ACTORS', async () => {
		delete process.env.BYPASS_ACTORS;

		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/app')
			.reply(200, { id: 456 })
			.get('/repos/test-org/test-repo/pulls/123/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/issues/123/comments')
			.reply(200, [])
			.post('/repos/test-org/test-repo/issues/123/comments', {
				body: instructionalComment,
			})
			.reply(200);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles empty BYPASS_ACTORS', async () => {
		process.env.BYPASS_ACTORS = '';

		const mock = nock('https://api.github.com')
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } })
			.get('/app')
			.reply(200, { id: 456 })
			.get('/repos/test-org/test-repo/pulls/123/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/issues/123/comments')
			.reply(200, [])
			.post('/repos/test-org/test-repo/issues/123/comments', {
				body: instructionalComment,
			})
			.reply(200);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles multiple BYPASS_ACTORS values', async () => {
		process.env.BYPASS_ACTORS = '5,10,15';

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
