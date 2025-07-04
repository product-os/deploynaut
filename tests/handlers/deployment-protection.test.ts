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

// Load the policy config fixtures
const authorApprovalFixture = fs.readFileSync(
	path.join(__dirname, '../fixtures/policy-configs/author-approval.yml'),
	'utf-8',
);

const basicApprovalFixture = fs.readFileSync(
	path.join(__dirname, '../fixtures/policy-configs/basic-approval-only.yml'),
	'utf-8',
);

const deployCommentFixture = fs.readFileSync(
	path.join(
		__dirname,
		'../fixtures/policy-configs/deploy-comment-patterns.yml',
	),
	'utf-8',
);

const signatureApprovalFixture = fs.readFileSync(
	path.join(__dirname, '../fixtures/policy-configs/signature-approval.yml'),
	'utf-8',
);

// Test fixtures
interface TestFixture {
	deployment_protection_rule: {
		action: string;
		environment: string;
		deployment: {
			sha: string;
			environment: string;
			id: number;
		};
		deployment_callback_url: string;
		pull_requests: Array<{
			// eslint-disable-next-line id-denylist
			number: number;
			head: {
				sha: string;
			};
		}>;
		repository: {
			name: string;
			owner: {
				login: string;
			};
		};
		installation: {
			id: number;
		};
	};
}

const testFixtures: TestFixture = {
	deployment_protection_rule: {
		action: 'requested',
		environment: 'test-environment',
		deployment: {
			sha: 'test-sha',
			environment: 'test-environment',
			id: 123,
		},
		deployment_callback_url:
			'https://api.github.com/repos/test-org/test-repo/actions/runs/123/deployment_protection_rule',
		pull_requests: [
			{
				// eslint-disable-next-line id-denylist
				number: 1,
				head: {
					sha: 'test-sha',
				},
			},
		],
		repository: {
			name: 'test-repo',
			owner: {
				login: 'test-org',
			},
		},
		installation: {
			id: 12345678,
		},
	},
};

describe('Deployment Protection Rule Handler', () => {
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

	test('approves deployment when commit is authored by certain users', async () => {
		// Override the beforeEach setup to use author-approval fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, authorApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'test-bot' },
				committer: { id: 123, login: 'test-bot' },
				commit: {
					verification: { verified: true, reason: 'valid' },
				},
			})
			.post(
				'/repos/test-org/test-repo/actions/runs/123/deployment_protection_rule',
			)
			.reply(200);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('approves deployment an approved maintainer review', async () => {
		// Override the beforeEach setup to use basic-approval fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'unauthorized-user' },
				committer: { id: 123, login: 'unauthorized-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [
				{
					user: { id: 456, login: 'maintainer-user' },
					state: 'APPROVED',
					body: 'LGTM',
					commit_id: 'test-sha',
					html_url: 'https://github.com/test-org/test-repo/pull/1#review',
					submitted_at: '2023-01-01T00:00:00Z',
				},
			])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'unauthorized-user' },
				},
			])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'maintainer-user',
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/123/deployment_protection_rule',
			)
			.reply(200);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('approves deployment with maintainer deploy comment', async () => {
		// Override the beforeEach setup to use deploy-comment-patterns fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, deployCommentFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'unauthorized-user' },
				committer: { id: 123, login: 'unauthorized-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [
				{
					user: { id: 456, login: 'maintainer-user' },
					state: 'COMMENTED',
					body: '/deploy this now',
					commit_id: 'test-sha',
					html_url: 'https://github.com/test-org/test-repo/pull/1#review',
					submitted_at: '2023-01-01T00:00:00Z',
				},
			])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'unauthorized-user' },
				},
			])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'maintainer-user',
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/123/deployment_protection_rule',
			)
			.reply(200);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('approves deployment when commits have valid signatures by test-users team', async () => {
		// Override the beforeEach setup to use signature-approval fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, signatureApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: {
					id: 123,
					login: 'test-user',
					organizations: [{ login: 'test-org' }],
				},
				committer: {
					id: 123,
					login: 'test-user',
					organizations: [{ login: 'test-org' }],
				},
				commit: {
					verification: {
						verified: true,
						reason: 'valid',
					},
				},
			})
			.get('/orgs/test-org/teams/test-users/members')
			.reply(200, [
				{
					login: 'test-user',
				},
			])
			.post(
				'/repos/test-org/test-repo/actions/runs/123/deployment_protection_rule',
			)
			.reply(200);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('skips deployment when policy requirements are not met', async () => {
		// Override the beforeEach setup to use basic-approval fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'unauthorized-user' },
				committer: { id: 123, login: 'unauthorized-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'unauthorized-user' },
				},
			]);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles missing environment or deployment gracefully', async () => {
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const payloadWithoutDeployment = {
			...testFixtures.deployment_protection_rule,
			deployment: null,
		};

		// Should not make any API calls when payload is invalid
		await probot.receive({
			name: 'deployment_protection_rule',
			payload: payloadWithoutDeployment,
		});

		// No pending mocks means no unexpected API calls were made
		expect(nock.pendingMocks()).toStrictEqual([]);
	});

	test('handles missing configuration gracefully', async () => {
		// Override the config endpoint to return 404
		nock.cleanAll();
		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(404)
			// Probot will also check the organization's .github repo
			.get('/repos/test-org/.github/contents/.github%2Fdeploynaut.yml')
			.reply(404)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('rejects deployment with non-maintainer review', async () => {
		// Override the beforeEach setup to use basic-approval fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'unauthorized-user' },
				committer: { id: 123, login: 'unauthorized-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [
				{
					user: { id: 456, login: 'regular-user' },
					state: 'APPROVED',
					body: 'LGTM',
					commit_id: 'test-sha',
					html_url: 'https://github.com/test-org/test-repo/pull/1#review',
					submitted_at: '2023-01-01T00:00:00Z',
				},
			])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'unauthorized-user' },
				},
			])
			.get('/orgs/test-org/teams/test-maintainers/members')
			.reply(200, [
				{
					login: 'test-reviewer',
				},
			]);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles deployment without pull requests', async () => {
		// Override the beforeEach setup to use basic-approval fixture
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const payloadWithoutPRs = {
			...testFixtures.deployment_protection_rule,
			pull_requests: null,
		};

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'unauthorized-user' },
				committer: { id: 123, login: 'unauthorized-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			});

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: payloadWithoutPRs,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles commit with undefined author', async () => {
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: null,
				committer: { id: 123, login: 'test-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			// Called once for commit committer only
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'test-user' },
				},
			]);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles commit with undefined committer', async () => {
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'test-user' },
				committer: null,
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'test-user' },
				},
			]);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles commit with undefined verification', async () => {
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'test-user' },
				committer: { id: 123, login: 'test-user' },
				commit: {
					verification: null,
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: { id: 123, login: 'test-user' },
				},
			]);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});

	test('handles PR commits with undefined author', async () => {
		nock.cleanAll();
		nock('https://api.github.com')
			.get('/repos/test-org/test-repo/contents/.github%2Fdeploynaut.yml')
			.reply(200, basicApprovalFixture)
			.post('/app/installations/12345678/access_tokens')
			.reply(200, { token: 'test', permissions: { issues: 'write' } });

		const mock = nock('https://api.github.com')
			.get('/repos/test-org/test-repo/commits/test-sha')
			.reply(200, {
				sha: 'test-sha',
				author: { id: 123, login: 'test-user' },
				committer: { id: 123, login: 'test-user' },
				commit: {
					verification: { verified: false, reason: 'unsigned' },
				},
			})
			.get('/repos/test-org/test-repo/pulls/1/reviews')
			.reply(200, [])
			.get('/repos/test-org/test-repo/pulls/1/commits')
			.reply(200, [
				{
					sha: 'test-sha',
					author: null,
				},
			]);

		await probot.receive({
			name: 'deployment_protection_rule',
			payload: testFixtures.deployment_protection_rule,
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});
});
