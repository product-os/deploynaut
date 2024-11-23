import nock from 'nock';
import myProbotApp from '../src/index.js';
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
		},
		installation: { id: 12345678 },
		repository: {
			owner: {
				login: 'test-org',
			},
			name: 'test-repo',
		},
	},
	issue_comment: {
		action: 'created',
		issue: {
			// eslint-disable-next-line id-denylist
			number: 123,
			pull_request: {},
		},
		comment: {
			id: 456,
			user: {
				login: 'test-user',
				type: 'User',
			},
			body: '/deploy please',
			created_at: '2024-01-01T00:00:00Z',
			updated_at: '2024-01-01T00:00:00Z',
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
		process.env.BYPASS_ACTORS = '5';
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
		test('approves deployment for allowed user', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
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

		test('ignores events with missing properties', async () => {
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

		test('ignores non-pull-request events', async () => {
			const payload = {
				...testFixtures.deployment_protection_rule,
				event: 'push',
			};

			const result = await probot.receive({
				name: 'deployment_protection_rule',
				payload: payload,
			});

			expect(result).toBeUndefined();
			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('throws error on failure to get app user', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/graphql')
				.reply(404, { message: 'Not Found' });

			await expect(
				probot.receive({
					name: 'deployment_protection_rule',
					payload: testFixtures.deployment_protection_rule,
				}),
			).rejects.toThrow('Failed to get app user');

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores deployment from self', async () => {
			const payload = {
				...testFixtures.deployment_protection_rule,
				deployment: {
					creator: {
						login: 'test-bot',
						id: 123,
					},
				},
			};

			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
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

		test('ignores deployment from unauthorized user', async () => {
			const payload = {
				...testFixtures.deployment_protection_rule,
				deployment: {
					creator: {
						login: 'unauthorized-user',
						id: 789,
					},
				},
			};

			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
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
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/repos/test-org/test-repo/issues/comments/456/reactions')
				.reply(200)
				.post('/graphql')
				.reply(200, {
					data: {
						viewer: {
							login: 'test-bot',
							databaseId: 123,
						},
					},
				})
				.get('/repos/test-org/test-repo/collaborators/test-user/permission')
				.reply(200, { permission: 'admin' })
				.get('/repos/test-org/test-repo/pulls/123')
				.reply(200, {
					head: { sha: 'test-sha' },
				})
				.get('/repos/test-org/test-repo/actions/runs')
				.query(true)
				.reply(200, { workflow_runs: [] });

			await probot.receive({
				name: 'issue_comment',
				payload: testFixtures.issue_comment,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores non-deploy comments', async () => {
			const payload = {
				...testFixtures.issue_comment,
				comment: {
					...testFixtures.issue_comment.comment,
					body: 'Just a regular comment',
				},
			};

			await probot.receive({
				name: 'issue_comment',
				payload,
			});

			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores bot comments', async () => {
			const payload = {
				...testFixtures.issue_comment,
				comment: {
					...testFixtures.issue_comment.comment,
					user: {
						...testFixtures.issue_comment.comment.user,
						type: 'Bot',
					},
				},
			};

			await probot.receive({
				name: 'issue_comment',
				payload,
			});

			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores edited comments', async () => {
			const payload = {
				...testFixtures.issue_comment,
				comment: {
					...testFixtures.issue_comment.comment,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:01:00Z',
				},
			};

			await probot.receive({
				name: 'issue_comment',
				payload,
			});

			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores comments on non-pull-requests', async () => {
			const payload = {
				...testFixtures.issue_comment,
				issue: {
					...testFixtures.issue_comment.issue,
					pull_request: null,
				},
			};

			await probot.receive({
				name: 'issue_comment',
				payload,
			});

			expect(nock.pendingMocks()).toStrictEqual([]);
		});

		test('throws error on failure to get app user', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/repos/test-org/test-repo/issues/comments/456/reactions')
				.reply(200)
				.post('/graphql')
				.reply(404, { message: 'Not Found' });

			await expect(
				probot.receive({
					name: 'issue_comment',
					payload: testFixtures.issue_comment,
				}),
			).rejects.toThrow('Failed to get app user');

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores comments from self', async () => {
			const payload = {
				...testFixtures.issue_comment,
				comment: {
					...testFixtures.issue_comment.comment,
					user: {
						...testFixtures.issue_comment.comment.user,
						login: 'test-bot',
					},
				},
			};

			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/repos/test-org/test-repo/issues/comments/456/reactions')
				.reply(200)
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
				name: 'issue_comment',
				payload,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});

		test('ignores comments from users without write access', async () => {
			const mock = nock('https://api.github.com')
				.post('/app/installations/12345678/access_tokens')
				.reply(200, { token: 'test', permissions: { issues: 'write' } })
				.post('/repos/test-org/test-repo/issues/comments/456/reactions')
				.reply(200)
				.post('/graphql')
				.reply(200, {
					data: {
						viewer: {
							login: 'test-bot',
							databaseId: 123,
						},
					},
				})
				.get('/repos/test-org/test-repo/collaborators/test-user/permission')
				.reply(200, { permission: 'read' });

			await probot.receive({
				name: 'issue_comment',
				payload: testFixtures.issue_comment,
			});

			expect(mock.pendingMocks()).toStrictEqual([]);
		});
	});
});
