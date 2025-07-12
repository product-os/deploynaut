// Types for the policy configuration
export interface PolicyConfig {
	policy: {
		approval: string[] | ApprovalRule[];
	};
	approval_rules: NamedApprovalRule[];
}

export interface ApprovalRule {
	or?: string[] | ApprovalRule[];
	and?: string[] | ApprovalRule[];
}

export interface NamedApprovalRule {
	name: string;
	if?: RuleCondition;
	requires?: ApprovalRequirement;
	methods?: ApprovalMethods;
}

export interface RuleCondition {
	ref_patterns?: string[];
	environment?: {
		matches?: string[];
		not_matches?: string[];
	};
	has_valid_signatures_by?: {
		users?: string[];
		organizations?: string[];
		teams?: string[];
	};
	only_has_contributors_in?: {
		users?: string[];
		organizations?: string[];
		teams?: string[];
	};
}

export interface ApprovalRequirement {
	count: number;
	teams?: string[];
	users?: string[];
	organizations?: string[];
}

export interface ApprovalMethods {
	github_review?: boolean;
	github_review_comment_patterns?: string[];
}

export interface Commit {
	author?: {
		id: number;
		login: string;
	};
	committer?: {
		id: number;
		login: string;
	};
	verification?: {
		verified: boolean;
		reason: string;
	};
	sha: string;
}

export interface Team {
	slug: string;
	organization: string;
}

export interface Review {
	id: number;
	user: {
		id: number;
		login: string;
	};
	state: string;
	body?: string;
	commit_id: string;
	html_url?: string;
	submitted_at?: string;
}

// Context types for policy evaluation
export interface PolicyContext {
	environment?: {
		name: string;
	};
	deployment?: {
		ref?: string;
		environment?: string;
		event?: string;
		commit: Commit;
	};
	commits: Commit[];
	reviews: Review[];
}
