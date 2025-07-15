import type { Context } from 'probot';
import type {
	PolicyContext,
	ApprovalRule,
	NamedApprovalRule,
	PolicyConfig,
	RuleCondition,
	ApprovalRequirement,
	ApprovalMethods,
} from './types.js';
import { listTeamMembers, listOrganizationMembers } from '../client.js';
import type { Commit } from './types.js';

/**
 * Logger interface for outputting evaluation messages
 */
interface Logger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/**
 * Result type for rule evaluation
 * - true: rule passed
 * - false: rule failed
 * - 'skipped': rule conditions not met, so it was skipped
 */
type RuleResult = boolean | 'skipped';

/**
 * PolicyEvaluator evaluates deployment policies based on configured approval rules
 *
 * The evaluator supports:
 * - OR logic between top-level approval rules
 * - AND logic within rule groups
 * - Conditional rules based on environment, signatures, and authorship
 * - Multiple approval methods (GitHub reviews, comment patterns)
 * - Team, organization, and user-based requirements
 * - Simplified signature validation using GitHub's verification status and committer authorization
 */
export class PolicyEvaluator {
	private config: PolicyConfig;
	private context: PolicyContext;
	private logger: Logger;
	private githubContext: Context;
	/**
	 * Create a new PolicyEvaluator
	 * @param config Policy configuration containing approval rules
	 * @param logger Logger for outputting evaluation messages (defaults to console)
	 */
	constructor(
		config: PolicyConfig,
		githubContext: Context,
		logger: Logger = console,
	) {
		this.config = config;
		this.logger = logger;
		this.githubContext = githubContext;
	}

	/**
	 * Evaluate the policy against the given context
	 * @param context The deployment context containing commits, reviews, environment, etc.
	 * @returns true if policy allows deployment, false otherwise
	 */
	async evaluate(context: PolicyContext): Promise<boolean> {
		this.context = context;
		const approvalRules = this.config.policy.approval;

		// If no approval rules are configured, do not allow deployment
		if (!approvalRules || approvalRules.length === 0) {
			this.logger.warn('No approval rules found - deployment not allowed');
			return false;
		}

		// Evaluate all approval rules (OR logic at top level)
		const result = await this.evaluateRules(approvalRules);
		if (result === false) {
			this.logger.warn('Policy evaluation failed - deployment not allowed');
		}
		return result === true;
	}

	/**
	 * Evaluate a collection of rules using OR logic
	 * @param rules Array of rule names or rule objects to evaluate
	 * @returns 'skipped' if all rules were skipped, otherwise boolean result
	 */
	private async evaluateRules(
		rules: string[] | ApprovalRule[],
	): Promise<RuleResult> {
		// Evaluate each rule in the collection
		const results = await Promise.all(
			rules.map((rule) => this.evaluateRule(rule)),
		);

		// Filter out skipped rules to get actual results
		const nonSkippedResults = results.filter(
			(r): r is boolean => r !== 'skipped',
		);

		// If all rules were skipped, return skipped
		if (nonSkippedResults.length === 0) {
			return 'skipped';
		}

		// For OR logic, return true if any rule passed
		return nonSkippedResults.some((r) => r === true);
	}

	/**
	 * Evaluate a single rule (can be a named rule, AND group, OR group, or array)
	 * @param rule The rule to evaluate
	 * @returns Result of rule evaluation
	 */
	private async evaluateRule(rule: string | ApprovalRule): Promise<RuleResult> {
		this.logger.info(`Evaluating approval: ${JSON.stringify(rule)}`);

		// Handle named rule references
		if (typeof rule === 'string') {
			const namedRule = this.findNamedRule(rule);
			if (!namedRule) {
				this.logger.error(`Rule "${rule}" not found in configuration`);
				throw new Error(`Rule "${rule}" not found in configuration`);
			}
			return await this.evaluateNamedRule(namedRule);
		}

		// Handle AND logic: all sub-rules must pass
		if (rule.and) {
			const results = await Promise.all(
				rule.and.map((subRule) => this.evaluateRule(subRule)),
			);
			const nonSkippedResults = results.filter(
				(r): r is boolean => r !== 'skipped',
			);

			// If all sub-rules were skipped, skip this rule too
			if (nonSkippedResults.length === 0) {
				return 'skipped';
			}

			// For AND logic, all non-skipped rules must pass
			return nonSkippedResults.every((r) => r === true);
		}

		// Handle arrays as OR rules
		if (Array.isArray(rule)) {
			return await this.evaluateRules(rule);
		}

		// Handle explicit OR rules
		if (rule.or) {
			return await this.evaluateRules(rule.or);
		}

		// Unknown rule format
		return false;
	}

	/**
	 * Find a named approval rule by name in the configuration
	 * @param name Name of the rule to find
	 * @returns The named rule if found, undefined otherwise
	 */
	private findNamedRule(name: string): NamedApprovalRule | undefined {
		return this.config.approval_rules.find(
			(rule: NamedApprovalRule) => rule.name === name,
		);
	}

	/**
	 * Evaluate a named approval rule
	 * @param rule The named rule to evaluate
	 * @returns Result of rule evaluation
	 */
	private async evaluateNamedRule(
		rule: NamedApprovalRule,
	): Promise<RuleResult> {
		this.logger.debug(`Evaluating rule: ${JSON.stringify(rule)}`);

		// First check if rule conditions are met
		if (rule.if && !(await this.evaluateConditions(rule.if))) {
			this.logger.info(`Rule "${rule.name}" skipped - conditions not met`);
			return 'skipped';
		}

		// If no requirements or count is 0, rule passes automatically
		if (!rule.requires || rule.requires.count < 1) {
			this.logger.info(`Rule "${rule.name}" is satisfied with no requirements`);
			return true;
		}

		// Check if approval requirements are met
		if (!(await this.evaluateRequirements(rule.requires, rule.methods))) {
			this.logger.warn(`Policy requirements not met for rule "${rule.name}"`);
			return false;
		}

		return true;
	}

	/**
	 * Evaluate rule conditions (environment, signatures, authorship)
	 * @param conditions The conditions to evaluate
	 * @returns true if all conditions are met, false otherwise
	 */
	private evaluateEnvironmentCondition(
		condition: NonNullable<RuleCondition['environment']>,
	): boolean {
		const envName = this.context.environment?.name;
		if (!envName) {
			this.logger.warn('No environment name found in context');
			return false;
		}

		// Check if environment matches allowed list
		if (condition.matches && !condition.matches.includes(envName)) {
			this.logger.warn(
				`Environment "${envName}" does not match any allowed environments`,
			);
			return false;
		}

		// Check if environment is in excluded list
		if (condition.not_matches?.includes(envName)) {
			this.logger.warn(
				`Environment "${envName}" is explicitly excluded by the policy`,
			);
			return false;
		}

		return true;
	}

	private evaluateHasValidSignaturesCondition(): boolean {
		const commits = this.context.commits;

		if (commits.length === 0) {
			this.logger.warn('No commits found for signature validation');
			return false;
		}
		const results = commits.map((commit: Commit) => {
			// Check if GitHub verified the signature
			if (!commit.verification?.verified) {
				this.logger.debug(
					`Commit "${commit.sha}" signature not verified by GitHub: ${commit.verification?.reason ?? 'unknown'}`,
				);
				return false;
			}
			this.logger.debug(
				`Commit "${commit.sha}" signature verified by GitHub: ${commit.verification?.reason ?? 'unknown'}`,
			);
			return true;
		});

		const result = results.every(Boolean);
		this.logger.info(`Evaluated condition has_valid_signatures: ${result}`);
		return result;
	}

	private async evaluateHasValidSignaturesByCondition(
		condition: NonNullable<RuleCondition['has_valid_signatures_by']>,
	): Promise<boolean> {
		const commits = this.context.commits;
		const { users, organizations, teams } = condition;

		// Check signature verification using GitHub's verification status
		const results = await Promise.all(
			commits.map(async (commit: Commit) => {
				const isValid = await this.validateCommitSignature(commit, {
					users,
					organizations,
					teams,
				});

				if (!isValid) {
					return false;
				}
				return true;
			}),
		);

		const result = results.every(Boolean);
		this.logger.info(`Evaluated condition has_valid_signatures_by: ${result}`);
		return result;
	}

	private async evaluateOnlyHasAuthorsInCondition(
		condition: NonNullable<RuleCondition['only_has_authors_in']>,
	): Promise<boolean> {
		const { users, organizations, teams } = condition;
		const commits = this.context.commits;

		// If there are no commits, return false
		if (commits.length === 0) {
			return false;
		}

		// Check that all commits were authored by the specified users/organizations/teams
		const results = await Promise.all(
			commits.map(async (commit: Commit) => {
				return await this.isUserInAny(
					commit.author?.login ?? '',
					users ?? [],
					organizations ?? [],
					teams ?? [],
				);
			}),
		);

		const result = results.every(Boolean);
		this.logger.info(
			`Evaluated condition only_has_authors_in: ${JSON.stringify(condition)}: ${result}`,
		);
		return result;
	}

	private async evaluateOnlyHasContributorsInCondition(
		condition: NonNullable<RuleCondition['only_has_contributors_in']>,
	): Promise<boolean> {
		const { users, organizations, teams } = condition;
		const commits = this.context.commits;

		// If there are no commits, return false
		if (commits.length === 0) {
			return false;
		}

		// Check that all commits were authored and committed by the specified users/organizations/teams
		const results = await Promise.all(
			commits.map(async (commit: Commit) => {
				const author = commit.author;
				const committer = commit.committer;
				const isAuthorAuthorized = await this.isUserInAny(
					author?.login ?? '',
					users ?? [],
					organizations ?? [],
					teams ?? [],
				);
				const isCommitterAuthorized = await this.isUserInAny(
					committer?.login ?? '',
					users ?? [],
					organizations ?? [],
					teams ?? [],
				);
				return isAuthorAuthorized && isCommitterAuthorized;
			}),
		);

		const result = results.every(Boolean);
		this.logger.info(
			`Evaluated condition only_has_contributors_in: ${JSON.stringify(condition)}: ${result}`,
		);
		return result;
	}

	private async evaluateConditions(
		conditions: RuleCondition,
	): Promise<boolean> {
		const conditionPromises: Array<Promise<boolean>> = [];

		// Add condition promises based on what's present in the conditions object
		if (conditions.environment) {
			conditionPromises.push(
				Promise.resolve(
					this.evaluateEnvironmentCondition(conditions.environment),
				),
			);
		}

		if (conditions.has_valid_signatures) {
			conditionPromises.push(
				Promise.resolve(this.evaluateHasValidSignaturesCondition()),
			);
		}

		if (conditions.has_valid_signatures_by) {
			conditionPromises.push(
				this.evaluateHasValidSignaturesByCondition(
					conditions.has_valid_signatures_by,
				),
			);
		}

		if (conditions.only_has_authors_in) {
			conditionPromises.push(
				this.evaluateOnlyHasAuthorsInCondition(conditions.only_has_authors_in),
			);
		}

		if (conditions.only_has_contributors_in) {
			conditionPromises.push(
				this.evaluateOnlyHasContributorsInCondition(
					conditions.only_has_contributors_in,
				),
			);
		}

		// If no conditions were specified, return true
		if (conditionPromises.length === 0) {
			return true;
		}

		// Wait for all conditions to complete and check if all passed
		const results = await Promise.all(conditionPromises);
		const allConditionsPassed = results.every(Boolean);

		this.logger.info(
			`All conditions evaluation result: ${allConditionsPassed} (${results.length} conditions checked)`,
		);
		return allConditionsPassed;
	}

	private async evaluateRequirements(
		requirements: ApprovalRequirement,
		methods?: ApprovalMethods,
	): Promise<boolean> {
		const { count, teams, users, organizations } = requirements;
		const reviews = this.context.reviews;
		const commits = this.context.commits;
		const deploymentSha = this.context.deployment?.commit?.sha;

		// Filter reviews based on methods and user conditions
		const validReviews = reviews.filter((review) => {
			this.logger.info(`Evaluating review: ${JSON.stringify(review)}`);

			// Check if review is for the current deployment
			if (deploymentSha && review.commit_id !== deploymentSha) {
				this.logger.info(
					`Review ${review.id} is not for the current deployment`,
				);
				return false;
			}

			this.logger.info(`Review ${review.id} is for the current deployment`);

			// Check if reviewer is not the author or committer
			for (const commit of commits) {
				if (review.user.id === commit.author?.id) {
					this.logger.warn(
						`Review ${review.id} is by the author: ${commit.author?.login}`,
					);
					return false;
				}
				if (review.user.id === commit.committer?.id) {
					this.logger.warn(
						`Review ${review.id} is by the committer: ${commit.committer?.login}`,
					);
					return false;
				}
			}

			// Check review state and methods
			if (methods?.github_review) {
				if (review.state.toLowerCase() === 'approved') {
					this.logger.info(`Review ${review.id} is approved`);
					return true;
				}
			}

			function parsePattern(pattern: string): RegExp {
				// If pattern is wrapped in forward slashes, treat as regex
				if (pattern.startsWith('/') && pattern.match(/\/[gimuy]*$/)) {
					const match = pattern.match(/^\/(.+)\/([gimuy]*)$/);
					if (match) {
						return new RegExp(match[1], match[2]);
					}
				}
				// Otherwise treat as literal string match (case-insensitive)
				return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
			}

			// Check for comment patterns
			if (
				methods?.github_review_comment_patterns &&
				review.body &&
				review.state.toLowerCase() === 'commented'
			) {
				return methods.github_review_comment_patterns.some((pattern) => {
					try {
						const regex = parsePattern(pattern);
						const match = regex.test(review.body ?? '');
						if (match) {
							this.logger.info(
								`Review ${review.id} pattern "${pattern}" matches: ${review.body}`,
							);
						} else {
							this.logger.warn(
								`Review ${review.id} pattern "${pattern}" does not match: ${review.body}`,
							);
						}
						return match;
					} catch (error) {
						this.logger.error(`Pattern "${pattern}" is not valid: ${error}`);
						throw new Error(`Pattern "${pattern}" is not valid: ${error}`);
					}
				});
			}

			this.logger.info(`Review ${review.id} does not meet the requirements`);
			return false;
		});

		// Filter by reviews that meet membership requirements
		const reviewChecks = await Promise.all(
			validReviews.map(async (review) => {
				const authorized = await this.isUserInAny(
					review.user.login,
					users ?? [],
					organizations ?? [],
					teams ?? [],
				);
				if (authorized) {
					this.logger.info(
						`Review ${review.id} authored by an authorized user ${review.user.login}`,
					);
				} else {
					this.logger.warn(
						`Review ${review.id} authored by an unauthorized user ${review.user.login}`,
					);
				}
				return authorized;
			}),
		);

		const approvedReviews = validReviews.filter((_, idx) => reviewChecks[idx]);

		this.logger.info(
			`Found ${approvedReviews.length} eligible reviews per the policy requirements`,
		);

		return approvedReviews.length >= count;
	}

	private async isUserInAny(
		user: string,
		users: string[],
		organizations: string[],
		teams: string[],
	): Promise<boolean> {
		// Check users list first (synchronous)
		if (users.includes(user)) {
			return true;
		}

		// Check organization memberships
		for (const organization of organizations) {
			if (await this.isUserInOrganization(user, organization)) {
				return true;
			}
		}

		// Check team memberships
		for (const team of teams) {
			if (await this.isUserInTeam(user, team)) {
				return true;
			}
		}

		return false;
	}

	private async isUserInTeam(user: string, team: string): Promise<boolean> {
		try {
			const [org, slug] = team.split('/');
			const teamMembers = await listTeamMembers(this.githubContext, org, slug);
			return teamMembers.some((member) => member.login === user);
		} catch (error) {
			this.logger.warn(
				`Failed to check team membership for ${user} in ${team}: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
			return false;
		}
	}

	private async isUserInOrganization(
		user: string,
		organization: string,
	): Promise<boolean> {
		try {
			const organizationMembers = await listOrganizationMembers(
				this.githubContext,
				organization,
			);
			return organizationMembers.some((member) => member.login === user);
		} catch (error) {
			this.logger.warn(
				`Failed to check organization membership for ${user} in ${organization}: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
			return false;
		}
	}

	/**
	 * Validate a commit signature using GitHub's verification status and committer field
	 * @param commit The commit to validate
	 * @param policy The signature validation policy
	 * @returns true if signature is valid and authorized
	 */
	private async validateCommitSignature(
		commit: any,
		policy: { users?: string[]; organizations?: string[]; teams?: string[] },
	): Promise<boolean> {
		// Check if GitHub verified the signature
		if (!commit.verification?.verified) {
			this.logger.warn(
				`Commit "${commit.sha}" signature not verified by GitHub: ${commit.verification?.reason ?? 'unknown'}`,
			);
			return false;
		}

		// Get the committer information
		const committer = commit.committer;
		if (!committer) {
			this.logger.warn(`Commit "${commit.sha}" has no committer information`);
			return false;
		}

		// Check if committer is authorized
		const committerLogin = committer.login;

		if (
			await this.isUserInAny(
				committerLogin,
				policy.users ?? [],
				policy.organizations ?? [],
				policy.teams ?? [],
			)
		) {
			this.logger.info(
				`Commit "${commit.sha}" signed by an authorized user: ${committerLogin}`,
			);
			return true;
		}

		this.logger.warn(
			`Commit "${commit.sha}" signed by an unauthorized user: ${committerLogin}`,
		);
		return false;
	}
}
