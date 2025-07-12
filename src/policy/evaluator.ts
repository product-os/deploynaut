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
	 * Evaluate rule conditions (ref patterns, environment, signatures, authorship)
	 * @param conditions The conditions to evaluate
	 * @returns true if all conditions are met, false otherwise
	 */
	private async evaluateConditions(
		conditions: RuleCondition,
	): Promise<boolean> {
		// Check ref pattern conditions
		if (conditions.ref_patterns) {
			const deploymentRef = this.context.deployment?.ref;
			if (!deploymentRef) {
				this.logger.warn('No deployment ref found in context');
				return false;
			}

			// Check if deployment ref matches any of the patterns
			const matches = conditions.ref_patterns.some((pattern) => {
				return this.matchesPattern(deploymentRef, pattern);
			});

			if (!matches) {
				this.logger.warn(
					`Deployment ref "${deploymentRef}" does not match any allowed patterns: ${conditions.ref_patterns.join(', ')}`,
				);
				return false;
			}
		}

		// Check environment conditions
		if (conditions.environment) {
			const envName = this.context.environment?.name;
			if (!envName) {
				this.logger.warn('No environment name found in context');
				return false;
			}

			// Check if environment matches allowed list
			if (
				conditions.environment.matches &&
				!conditions.environment.matches.includes(envName)
			) {
				this.logger.warn(
					`Environment "${envName}" does not match any allowed environments`,
				);
				return false;
			}

			// Check if environment is in excluded list
			if (conditions.environment.not_matches?.includes(envName)) {
				this.logger.warn(
					`Environment "${envName}" does not match any allowed environments`,
				);
				return false;
			}
		}

		if (conditions.has_valid_signatures_by) {
			const commits = this.context.commits;
			const { users, organizations, teams } =
				conditions.has_valid_signatures_by;

			// Check signature verification using GitHub's verification status
			for (const commit of commits) {
				const isValid = await this.validateCommitSignature(commit, {
					users,
					organizations,
					teams,
				});

				if (!isValid) {
					return false;
				}
			}
		}

		if (conditions.only_has_contributors_in) {
			const { users, organizations, teams } =
				conditions.only_has_contributors_in;
			const commits = this.context.commits;

			// If there are no commits, return false
			if (commits.length === 0) {
				return false;
			}

			// Check that all commits were authored and committed by the specified users/organizations/teams
			const results = await Promise.all(
				commits.map(
					async (commit: {
						sha: string;
						author?: { login?: string };
						committer?: { login?: string };
					}) => {
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
					},
				),
			);
			return results.every(Boolean);
		}

		return true;
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

			// Check for comment patterns
			if (
				methods?.github_review_comment_patterns &&
				review.body &&
				review.state.toLowerCase() === 'commented'
			) {
				return methods.github_review_comment_patterns.some((pattern) => {
					try {
						const match = this.matchesPattern(review.body ?? '', pattern);
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

	/**
	 * Parse a pattern string into a RegExp, supporting regex syntax, glob patterns, and literal matching
	 * @param pattern The pattern to parse (supports /regex/flags format, glob patterns with *, or literal strings)
	 * @returns RegExp for pattern matching
	 */
	private parsePattern(pattern: string): RegExp {
		// If pattern is wrapped in forward slashes, treat as regex
		if (pattern.startsWith('/') && pattern.match(/\/[gimuy]*$/)) {
			const match = pattern.match(/^\/(.+)\/([gimuy]*)$/);
			if (match) {
				return new RegExp(match[1], match[2]);
			}
		}

		// Convert glob pattern to regex
		// Escape regex special characters except * and ?
		let regexPattern = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars except * and ?
			.replace(/\*/g, '.*') // Convert glob * to regex .*
			.replace(/\?/g, '.'); // Convert glob ? to regex .

		// Anchor the pattern to match the entire string
		regexPattern = `^${regexPattern}$`;

		return new RegExp(regexPattern, 'i');
	}

	/**
	 * Test if a value matches a pattern
	 * @param value The value to test
	 * @param pattern The pattern to match against
	 * @returns true if pattern matches
	 */
	private matchesPattern(value: string, pattern: string): boolean {
		const regex = this.parsePattern(pattern);
		return regex.test(value);
	}
}
