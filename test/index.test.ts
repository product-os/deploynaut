import nock from 'nock';
import myProbotApp from '../src/index.js';
import { Probot, ProbotOctokit } from 'probot';
import fs from 'fs';
import path from 'path';
import { describe, beforeEach, afterEach, test, expect } from 'vitest';

// Load test fixtures
const deploymentProtectionRule = JSON.parse(
	fs.readFileSync(
		path.join(__dirname, 'fixtures/deployment_protection_rule.requested.json'),
		'utf-8',
	),
);

const issueComment = JSON.parse(
	fs.readFileSync(
		path.join(__dirname, 'fixtures/issue_comment.created.json'),
		'utf-8',
	),
);

const privateKey = fs.readFileSync(
	path.join(__dirname, 'fixtures/mock-cert.pem'),
	'utf-8',
);

describe('GitHub Deployment App', () => {
	let probot: any;

	beforeEach(() => {
		nock.disableNetConnect();
		probot = new Probot({
			appId: 123,
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
		test('approves deployment for allowed user', async () => {
			// Mock installation token and GraphQL API call for whoAmI
			const mock = nock('https://api.github.com')
				.post('/app/installations/57364329/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/graphql')
				.reply(200, {
					data: {
						viewer: {
							login: 'test-bot',
							databaseId: 123,
						},
					},
				})
				// Mock deployment approval callback
				.post(
					'/repos/balena-io-experimental/deployable/actions/runs/11921637963/deployment_protection_rule',
				)
				.reply(200);

			await probot.receive({
				name: 'deployment_protection_rule',
				payload: deploymentProtectionRule,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores deployment from self', async () => {
			const payload = {
				...deploymentProtectionRule,
				deployment: {
					...deploymentProtectionRule.deployment,
					creator: {
						login: 'test-bot',
					},
				},
			};

			// Mock installation token and GraphQL API call for whoAmI
			const mock = nock('https://api.github.com')
				.post('/app/installations/57364329/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/graphql')
				.reply(200, {
					data: {
						viewer: {
							login: 'test-bot',
							databaseId: 123,
						},
					},
				});

			await probot.receive({
				name: 'deployment_protection_rule',
				payload,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});
	});

	describe('issue_comment.created', () => {
		test('processes valid deploy comment', async () => {
			// Mock all required API calls
			const mock = nock('https://api.github.com')
				// Mock installation token
				.post('/app/installations/57364329/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				// Add eyes reaction
				.post(
					'/repos/balena-io-experimental/deployable/issues/comments/2486741061/reactions',
				)
				.reply(200)
				// Get app identity
				.post('/graphql')
				.reply(200, {
					data: {
						viewer: {
							login: 'test-bot',
							databaseId: 123,
						},
					},
				})
				// Check user permissions
				.get(
					'/repos/balena-io-experimental/deployable/collaborators/klutchell/permission',
				)
				.reply(200, { permission: 'admin' })
				// Get PR details
				.get('/repos/balena-io-experimental/deployable/pulls/2')
				.reply(200, {
					head: { sha: 'abec9b0' },
				})
				// List workflow runs
				.get('/repos/balena-io-experimental/deployable/actions/runs')
				.query(true)
				.reply(200, { workflow_runs: [] });

			await probot.receive({
				name: 'issue_comment',
				payload: issueComment,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores non-deploy comments', async () => {
			const payload = {
				...issueComment,
				comment: {
					...issueComment.comment,
					body: 'Just a regular comment',
				},
			};

			await probot.receive({
				name: 'issue_comment',
				payload,
			});

			// No API calls should be made
			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores bot comments', async () => {
			const payload = {
				...issueComment,
				comment: {
					...issueComment.comment,
					user: {
						...issueComment.comment.user,
						type: 'Bot',
					},
				},
			};

			await probot.receive({
				name: 'issue_comment',
				payload,
			});

			// No API calls should be made
			expect(nock.pendingMocks()).toStrictEqual([]);
		});
	});
});
